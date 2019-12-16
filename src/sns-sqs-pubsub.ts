import { Message, MessageAttributes } from '@node-ts/bus-messages';
import {
  toMessageAttributeMap,
  fromMessageAttributeMap,
  SQSMessageBody
} from '@node-ts/bus-sqs/dist/sqs-transport';
import aws, { SQS, SNS } from 'aws-sdk';
import { PubSubEngine } from 'graphql-subscriptions';
import { PubSubAsyncIterator } from 'graphql-subscriptions/dist/pubsub-async-iterator';
import {
  PubSubOptions,
  ExtendedPubSubOptions,
  PubSubMessageBody
} from './types';
import { ConfigurationOptions } from 'aws-sdk/lib/config';
import { ConfigurationServicePlaceholders } from 'aws-sdk/lib/config_service_placeholders';
import Debug from 'debug';

const debug = Debug('gql-snssqs-subscriptions');

const MILLISECONDS_IN_SECONDS = 1000;
const AWS_SDK_SQS_API_VERSION = '2012-11-05';
const AWS_SDK_SNS_API_VERSION = '2010-03-31';

export class SNSSQSPubSub implements PubSubEngine {
  public sqs!: SQS;
  public sns!: SNS;
  private clientConfig: SQS.Types.ClientConfiguration;
  private options: ExtendedPubSubOptions = {
    withSNS: true,
    serviceName: '',
    stopped: false,
    queueUrl: '',
    dlQueueUrl: '',
    dlQueueArn: '',
    queueArn: '',
    topicArn: '',
    subscriptionArn: '',
    availableTopicsList: []
  };
  private pollerId: any = null;

  public constructor(
    config: ConfigurationOptions & ConfigurationServicePlaceholders = {},
    pubSubOptions: PubSubOptions
  ) {
    aws.config.update(config);

    this.clientConfig = config;
    this.options = { ...this.options, ...pubSubOptions };
    this.sqs = new aws.SQS({ apiVersion: AWS_SDK_SQS_API_VERSION });

    if (this.options.withSNS) {
      this.sns = new aws.SNS({ apiVersion: AWS_SDK_SNS_API_VERSION });
    }

    debug('Pubsub Engine is configured with :', this.options);
    debug('Pubsub Engine client is configured with :', this.clientConfig);
  }

  public init = async (): Promise<void> => {
    try {
      await this.createPubSub();
      debug('Pubsub Engine is created and has these options :', this.options);
    } catch (error) {
      debug('Pubsub Engine failed to create ', this.options, error);
      return undefined;
    }
  };

  public asyncIterator = <T>(triggers: string | string[]): AsyncIterator<T> => {
    return new PubSubAsyncIterator<T>(this, triggers);
  };

  public getOptions = (): ExtendedPubSubOptions => ({ ...this.options });

  public getClientConfig = (): SQS.Types.ClientConfiguration => ({
    ...this.clientConfig
  });

  private setupPolicies = (queueName: string) => {
    if (!this.options.topicArn) {
      return {};
    }

    const principalFromTopic = this.options.topicArn.split(':')[4];
    const queueArn = `arn:aws:sqs:${this.clientConfig.region}:${principalFromTopic}:${queueName}`;
    const queueArnDLQ = `${queueArn}-DLQ`;
    const idFromTopic = `${queueArn}/SQSDefaultPolicy`;
    this.options.queueArn = queueArn;
    this.options.dlQueueArn = queueArnDLQ;

    return {
      Version: '2012-10-17',
      Id: `${idFromTopic}`,
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: 'SQS:*',
          Resource: queueArn
        }
      ]
    };
  };

  public publish = async <MessageType extends Message>(
    triggerName: string,
    payload: MessageType,
    messageAttributes: MessageAttributes = new MessageAttributes()
  ): Promise<void> => {
    try {
      const attributeMap = toMessageAttributeMap({
        ...messageAttributes,
        ...{ attributes: { triggerName } }
      });

      if (this.options.withSNS) {
        const topicArn = this.getTriggerName(triggerName);

        debug(
          `Publishing message to topic ${topicArn} with attributes: `,
          attributeMap
        );

        const params: SNS.PublishInput = {
          TopicArn: topicArn,
          Message: JSON.stringify(payload),
          MessageAttributes: attributeMap
        };

        await this.sns.publish(params).promise();
      } else {
        const params: SQS.Types.SendMessageRequest = {
          QueueUrl: this.options.queueUrl,
          MessageBody: JSON.stringify(payload),
          MessageAttributes: attributeMap
        };

        await this.sqs.sendMessage(params).promise();
      }
    } catch (error) {
      debug('Error happened somewhere in publishing', error);
      return undefined;
    }
  };

  public subscribe = (
    triggerName: string,
    onMessage: (body: PubSubMessageBody) => any
  ): Promise<number> => {
    try {
      this.poll(triggerName, onMessage);

      return Promise.resolve(1);
    } catch (error) {
      debug('Error happens before starting to poll', error);
      return Promise.resolve(0);
    }
  };

  public unsubscribe = async (): Promise<void> => {
    if (!this.options.stopped) {
      this.options.stopped = true;
      this.pollerId = null;
    }
  };

  public readonly poll = async (
    triggerName: string,
    onMessage: (body: PubSubMessageBody) => any,
    stopImmediateLoop?: boolean
  ): Promise<void> => {
    if (this.options.stopped) {
      return;
    }

    const params = {
      MessageAttributeNames: ['.*'],
      WaitTimeSeconds: 10,
      QueueUrl: this.options.queueUrl,
      MaxNumberOfMessages: 1,
      AttributeNames: ['ApproximateReceiveCount']
    };

    const result = await this.sqs.receiveMessage(params).promise();

    if (!result.Messages || result.Messages.length === 0) {
      return undefined;
    }

    // Only handle the expected number of messages, anything else just return and retry
    if (result.Messages.length > 1) {
      debug('Received more than the expected number of messages', {
        expected: 1,
        received: result.Messages.length
      });
      await Promise.all(
        result.Messages.map(async message => this.makeMessageVisible(message))
      );
      return undefined;
    }

    const sqsMessage = result.Messages[0];

    debug('Received message from SQS', { sqsMessage });

    try {
      const snsMessage = JSON.parse(sqsMessage.Body!) as SQSMessageBody;

      if (!snsMessage.Message) {
        debug(
          'Message is not formatted with an SNS envelope and will be discarded',
          { sqsMessage }
        );
        await this.deleteMessage(sqsMessage);
        return undefined;
      }

      const attributes = fromMessageAttributeMap(snsMessage.MessageAttributes);

      debug('Received message attributes', {
        transportAttributes: snsMessage.MessageAttributes,
        messageAttributes: attributes
      });

      await this.deleteMessage(sqsMessage);

      onMessage({
        id: sqsMessage.MessageId!,
        raw: sqsMessage,
        domainMessage: JSON.parse(snsMessage.Message) as Message,
        attributes
      });

      if (stopImmediateLoop) {
        clearImmediate(this.pollerId);
        return undefined;
      }
    } catch (error) {
      debug(
        "Could not parse message. Message will be retried, though it's likely to end up in the dead letter queue",
        { sqsMessage, error }
      );

      await this.makeMessageVisible(sqsMessage);
      return undefined;
    }

    this.pollerId = setImmediate(() =>
      this.poll(triggerName, onMessage, stopImmediateLoop)
    );
  };

  private createPubSub = async (): Promise<void> => {
    // Create SNS Topic and SQS Queue
    try {
      if (this.options.withSNS) {
        await this.createTopic();
      }
      await this.createQueue();
    } catch (error) {
      debug(`Unable to configure PubSub channel ${error}`);
    }

    if (!this.options.withSNS) {
      return;
    }

    // Subscribe SNS Topic to SQS Queue
    try {
      const { SubscriptionArn } = await this.sns
        .subscribe({
          TopicArn: this.options.topicArn,
          Protocol: 'sqs',
          Endpoint: this.options.queueArn,
          Attributes: {
            RawMessageDelivery: 'true'
          },
          ReturnSubscriptionArn: true
        })
        .promise();
      this.options.subscriptionArn = SubscriptionArn!;
    } catch (error) {
      debug(
        `Unable to subscribe with these options ${this.options}, error: ${error}`
      );
      return undefined;
    }

    // Persist available topics in the options
    try {
      const { Topics } = await this.sns.listTopics().promise();
      this.options.availableTopicsList = Topics!;
    } catch (error) {
      debug(
        `Unable to fetch topics, might be problem when publishing messages ${this.options}, error ${error}`
      );
      return undefined;
    }
  };

  private createTopic = async (): Promise<void> => {
    const { serviceName } = this.options;
    try {
      const { TopicArn } = await this.sns
        .createTopic({ Name: `${serviceName}` })
        .promise();
      this.options.topicArn = TopicArn!;
    } catch (error) {
      debug(`Topic creation failed. ${error}`);
      return undefined;
    }
  };

  private createQueue = async (): Promise<void> => {
    const queueName = this.formQueueName();
    const queueNameeDLQ = this.formQueueName('-DLQ');

    const policy = {
      Policy: JSON.stringify(this.setupPolicies(queueName)),
      RedrivePolicy: `{"deadLetterTargetArn":"${this.options.dlQueueArn}","maxReceiveCount":"10"}`
    };

    const params = {
      QueueName: queueName,
      Attributes: {
        ...policy
      }
    };

    const paramsDLQ = {
      QueueName: queueNameeDLQ
    };

    try {
      const dlqQueueResult = await this.sqs.createQueue(paramsDLQ).promise();
      const queuResult = await this.sqs.createQueue(params).promise();
      this.options.queueUrl = queuResult.QueueUrl!;
      this.options.dlQueueUrl = dlqQueueResult.QueueUrl!;
    } catch (error) {
      debug(`Queue creation failed. ${error}`);
      return undefined;
    }
  };

  private async makeMessageVisible(sqsMessage: SQS.Message): Promise<void> {
    const changeVisibilityRequest: SQS.ChangeMessageVisibilityRequest = {
      QueueUrl: this.options.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!,
      VisibilityTimeout: this.calculateVisibilityTimeout(sqsMessage)
    };

    await this.sqs.changeMessageVisibility(changeVisibilityRequest).promise();
  }

  private deleteMessage = async (sqsMessage: SQS.Message): Promise<void> => {
    const params = {
      QueueUrl: this.options.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!
    };

    try {
      await this.sqs.deleteMessage(params).promise();
    } catch (error) {
      debug(`Unable to delete message ${error}`);
      return;
    }
  };

  private formQueueName = (providedSuffix?: string): string => {
    const { serviceName } = this.options;
    const queuePrefix =
      process.env.NODE_ENV == 'production'
        ? ''
        : process.env.NODE_ENV === 'test'
        ? 'test-'
        : 'development-';
    const queueRoot = serviceName;

    return `${queuePrefix}${queueRoot}${providedSuffix || ''}`;
  };

  private getTriggerName = (triggerName: string): string => {
    // publish message to itself
    if (triggerName === this.options.serviceName) {
      return this.options.topicArn;
    }

    // find topic by topic name in the topics list
    const result: SNS.Types.Topic[] = this.options.availableTopicsList.filter(
      (topic: SNS.Types.Topic) => {
        const topicParts = topic.TopicArn!.split(':');
        const topicName = topicParts[5];
        return topicName === triggerName;
      }
    );

    // return found topic or an return given argument
    return !!result ? result[0].TopicArn! : triggerName;
  };

  private calculateVisibilityTimeout = (sqsMessage: SQS.Message): number => {
    const currentReceiveCount = parseInt(
      (sqsMessage.Attributes &&
        sqsMessage.Attributes.ApproximateReceiveCount) ||
        '0',
      10
    );
    const numberOfFailures = currentReceiveCount + 1;

    const delay: number = 5 ^ numberOfFailures; // Delays from 5ms to ~2.5 hrs
    return delay / MILLISECONDS_IN_SECONDS;
  };
}
