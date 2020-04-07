import { Command, Event, Message, MessageAttributes } from '@node-ts/bus-messages';
import {
  toMessageAttributeMap,
  fromMessageAttributeMap,
  SqsMessageAttributes,
} from '@node-ts/bus-sqs/dist/sqs-transport';
import aws, { SQS, SNS } from 'aws-sdk';
import { PubSubEngine } from 'graphql-subscriptions';
import { PubSubAsyncIterator } from 'graphql-subscriptions/dist/pubsub-async-iterator';
import { PubSubOptions, ExtendedPubSubOptions, PubSubMessageBody } from './types';
import { ConfigurationOptions } from 'aws-sdk/lib/config';
import { ConfigurationServicePlaceholders } from 'aws-sdk/lib/config_service_placeholders';
import Debug from 'debug';

const debug = Debug('gql-snssqs-subscriptions');

const MILLISECONDS_IN_SECONDS = 1000;

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
    availableTopicsList: [],
  };

  public constructor(
    config: ConfigurationOptions & ConfigurationServicePlaceholders = {},
    pubSubOptions: PubSubOptions
  ) {
    aws.config.update(config);

    this.clientConfig = config;
    this.options = { ...this.options, ...pubSubOptions };
    this.sqs = new aws.SQS();

    if (this.options.withSNS) {
      this.sns = new aws.SNS();
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
    ...this.clientConfig,
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
          Resource: queueArn,
        },
      ],
    };
  };

  // generic pubsub engine publish method, still works with @node-ts/bus Event/Command
  async publish<MessageType extends Message>(
    triggerName: string,
    message: MessageType,
    messageAttributes?: MessageAttributes
  ): Promise<void> {
    const resolvedMessageName = this.resolveTopicFromMessageName(message.$name);
    if (resolvedMessageName !== triggerName) {
      if (resolvedMessageName !== `${this.options.prefix}-${triggerName}`) {
        console.error('triggerName should be found in message.$name, message was not published.');
        return;
      }
    }
    await this.publishMessage(message, messageAttributes);
  }

  // same as publish but specific for @node-ts/bus Event
  async sendEvent<EventType extends Event>(
    event: EventType,
    messageAttributes?: MessageAttributes
  ): Promise<void> {
    await this.publishMessage(event, messageAttributes);
  }

  // same as publish but specific for @node-ts/bus Command
  async sendCommand<CommandType extends Command>(
    command: CommandType,
    messageAttributes?: MessageAttributes
  ): Promise<void> {
    await this.publishMessage(command, messageAttributes);
  }

  private async publishMessage(
    message: Message,
    messageAttributes: MessageAttributes = new MessageAttributes()
  ): Promise<void> {
    const topicName = this.resolveTopicFromMessageName(message.$name);
    const topicArn = this.resolveTopicArnFromMessageName(topicName);
    debug('Publishing message to sns', { message, topicArn });

    const attributeMap = toMessageAttributeMap(messageAttributes);
    debug('Resolved message attributes', { attributeMap });

    const snsMessage: SNS.PublishInput = {
      TopicArn: topicArn,
      Subject: message.$name,
      Message: JSON.stringify(message),
      MessageAttributes: attributeMap,
    };
    debug('Sending message to SNS', { snsMessage });
    await this.sns.publish(snsMessage).promise();
  }

  public subscribe = (
    triggerName: string,
    onMessage: (body: PubSubMessageBody) => any
  ): Promise<number> => {
    try {
      this.pollMessage(triggerName, onMessage);

      return Promise.resolve(1);
    } catch (error) {
      debug('Error happens before starting to poll', error);
      return Promise.resolve(0);
    }
  };

  public unsubscribe = async (): Promise<void> => {
    if (!this.options.stopped) {
      this.options.stopped = true;
    }
  };

  public readonly pollMessage = async (
    topic: string,
    onMessage: (body: PubSubMessageBody) => any
  ): Promise<void> => {
    if (this.options.stopped) {
      return;
    }

    const params: SQS.ReceiveMessageRequest = {
      QueueUrl: this.options.queueUrl,
      WaitTimeSeconds: 10,
      MaxNumberOfMessages: 1,
      MessageAttributeNames: ['.*'],
      AttributeNames: ['ApproximateReceiveCount'],
    };

    const result = await this.sqs.receiveMessage(params).promise();

    if (!result.Messages || result.Messages.length === 0) {
      return;
    }

    // Only handle the expected number of messages, anything else just return and retry
    if (result.Messages.length > 1) {
      debug('Received more than the expected number of messages', {
        expected: 1,
        received: result.Messages.length,
      });
      await Promise.all(result.Messages.map(async (message) => this.makeMessageVisible(message)));
      return;
    }
    debug('Received result and messages', {
      result,
      resultMessages: result.Messages[0],
      resultMessageAttribute: result.Messages[0].MessageAttributes,
    });

    const sqsMessage = result.Messages[0];

    debug('Received message from SQS', { sqsMessage });

    try {
      const snsMessage = JSON.parse(sqsMessage.Body) as Message;

      if (!snsMessage) {
        debug('Message is not formatted with an SNS envelope and will be discarded', {
          sqsMessage,
        });
        await this.deleteMessage(sqsMessage);
        return;
      }

      const msgName = this.resolveTopicFromMessageName(snsMessage.$name);

      if (msgName !== topic) {
        if (msgName !== `${this.options.prefix}-${topic}`) {
          debug('message.$name does not have same topic');
          return;
        }
      }

      const transformedAttributes = this.attributesToComplyNodeBus(sqsMessage.MessageAttributes);
      const attributes = fromMessageAttributeMap(transformedAttributes);

      debug('Received message attributes', {
        transportAttributes: sqsMessage.MessageAttributes,
        messageAttributes: attributes,
      });

      await this.deleteMessage(sqsMessage);

      onMessage({
        id: sqsMessage.MessageId!,
        raw: sqsMessage,
        domainMessage: snsMessage,
        attributes,
      });
    } catch (error) {
      debug(
        "Could not parse message. Message will be retried, though it's likely to end up in the dead letter queue",
        { sqsMessage, error }
      );

      await this.makeMessageVisible(sqsMessage);
      return;
    }
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
            RawMessageDelivery: 'true',
          },
          ReturnSubscriptionArn: true,
        })
        .promise();
      this.options.subscriptionArn = SubscriptionArn!;
    } catch (error) {
      debug(`Unable to subscribe with these options ${this.options}, error: ${error}`);
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
    const { serviceName, prefix } = this.options;
    const formedPrefix = prefix ? `${prefix}-` : '';
    try {
      const { TopicArn } = await this.sns
        .createTopic({ Name: `${formedPrefix}${serviceName}` })
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
      RedrivePolicy: `{"deadLetterTargetArn":"${this.options.dlQueueArn}","maxReceiveCount":"10"}`,
    };

    const params = {
      QueueName: queueName,
      Attributes: {
        ...policy,
      },
    };

    const paramsDLQ = {
      QueueName: queueNameeDLQ,
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
      VisibilityTimeout: this.calculateVisibilityTimeout(sqsMessage),
    };

    await this.sqs.changeMessageVisibility(changeVisibilityRequest).promise();
  }

  private deleteMessage = async (sqsMessage: SQS.Message): Promise<void> => {
    const params = {
      QueueUrl: this.options.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!,
    };

    try {
      await this.sqs.deleteMessage(params).promise();
    } catch (error) {
      debug(`Unable to delete message ${error}`);
      return;
    }
  };

  private formQueueName = (providedSuffix?: string): string => {
    const { serviceName, prefix } = this.options;
    const queueRoot = serviceName;
    const formedPrefix = prefix ? `${prefix}-` : '';

    return `${formedPrefix}${queueRoot}${providedSuffix || ''}`;
  };

  private resolveTopicArnFromMessageName = (msgTopic: string): string => {
    // if provided topic arn resolve fn
    if (this.options.topicArnResolverFn) {
      return this.options.topicArnResolverFn(msgTopic);
    }

    // topic is itself service
    if (msgTopic === this.options.serviceName) {
      return this.options.topicArn;
    }

    // find topic by topic name in the topics list
    const result: SNS.Types.Topic[] = this.options.availableTopicsList.filter(
      (topic: SNS.Types.Topic) => {
        const topicParts = topic.TopicArn!.split(':');
        const topicName = topicParts[5];
        return topicName === msgTopic;
      }
    );

    // return found topic or return given argument
    return !!result ? result[0].TopicArn! : msgTopic;
  };

  private resolveTopicFromMessageName = (messageName: string): string => {
    const { prefix } = this.options;
    const resolvedTrigger = !!this.options.topicResolverFn
      ? this.options.topicResolverFn(messageName)
      : messageName.split('/')[1];

    if (prefix) {
      return `${prefix}-${resolvedTrigger}`;
    }

    return resolvedTrigger;
  };

  private calculateVisibilityTimeout = (sqsMessage: SQS.Message): number => {
    const currentReceiveCount = parseInt(
      (sqsMessage.Attributes && sqsMessage.Attributes.ApproximateReceiveCount) || '0',
      10
    );
    const numberOfFailures = currentReceiveCount + 1;

    const delay: number = 5 ^ numberOfFailures; // Delays from 5ms to ~2.5 hrs
    return delay / MILLISECONDS_IN_SECONDS;
  };

  private attributesToComplyNodeBus = (
    sqsAttributes: SNS.MessageAttributeMap
  ): SqsMessageAttributes => {
    let attributes: SqsMessageAttributes = {};

    Object.keys(sqsAttributes).forEach((key) => {
      const attribute = sqsAttributes[key];

      attributes[key] = {
        Type: attribute.DataType,
        Value: attribute.StringValue,
      };
    });

    return attributes;
  };
}
