import { SNS } from 'aws-sdk';
import { MessageAttributes, Message } from '@node-ts/bus-messages';
import { SQSMessageBody } from '@node-ts/bus-sqs/dist/sqs-transport';

export type PubSubOptions = {
  serviceName: string;
  withSNS?: boolean;
};

export type ExtendedPubSubOptions = {
  stopped: boolean;
  queueUrl: string;
  dlQueueUrl: string;
  dlQueueArn: string;
  queueArn: string;
  topicArn: string;
  subscriptionArn: string;
  availableTopicsList: SNS.Types.TopicsList;
  topicResolverFn?: (msgName: string) => string;
  topicArnResolverFn?: (topic: string) => string;
} & PubSubOptions;

type ObjectType = {
  [key: string]: any;
};

export { MessageAttributes, Message };

export interface PubSubMessageBody extends ObjectType {
  id: string;
  raw: any;
  domainMessage: Message;
  attributes: MessageAttributes;
}

export { SQSMessageBody as SNSSQSMessageBody };
