import { SNS } from 'aws-sdk';
import { MessageAttributes, Message } from '@node-ts/bus-messages';

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
} & PubSubOptions;

type ObjectType = {
  [key: string]: any;
};

export interface PubSubMessageBody extends ObjectType {
  id: string;
  raw: any;
  domainMessage: Message;
  attributes: MessageAttributes;
}
