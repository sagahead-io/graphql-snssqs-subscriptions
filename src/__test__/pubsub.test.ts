jest.mock('aws-sdk');
import * as AWS from 'aws-sdk-mock';
import { SQS } from 'aws-sdk';
import { SNSSQSPubSub } from '../index';
import { ExtendedPubSubOptions } from '../types';

const CreateTopicResult = {
  TopicArn: 'arn:aws:sns:region:id:TEST_TOPIC_NAME'
};

const CreateQueueResult = {
  QueueUrl: 'https://sqs.region.amazonaws.com/id/testQueueName'
};

const GeQueueAttrResult = {
  Attributes: {
    QueueArn: 'arn:aws:sns:region:id:testQueueArn'
  }
};

const SubscriptionResult = {
  SubscriptionArn: 'arn:aws:sns:region:id:TEST_TOPIC_NAME:uuid'
};

const ListTopicResult = {
  Topics: [CreateTopicResult]
};

describe('sqs-pub-sub', () => {
  beforeEach(() => {
    AWS.mock('SNS', 'createTopic', (params: any, callback: Function) => {
      callback(null, CreateTopicResult);
    });

    AWS.mock('SQS', 'createQueue', (params: any, callback: Function) => {
      callback(null, CreateQueueResult);
    });

    AWS.mock('SQS', 'getQueueAttributes', (params: any, callback: Function) => {
      callback(null, GeQueueAttrResult);
    });

    AWS.mock('SNS', 'subscribe', (params: any, callback: Function) => {
      callback(null, SubscriptionResult);
    });

    AWS.mock('SNS', 'listTopics', (params: any, callback: Function) => {
      callback(null, ListTopicResult);
    });
  });

  afterEach(() => {
    AWS.restore();
  });

  it('should create an instance', async () => {
    const instance = new SNSSQSPubSub({}, { serviceName: 'mysuperservice' });

    expect(instance).toBeDefined();
  });

  it('can call', async () => {
    const instance = new SNSSQSPubSub({}, { serviceName: 'mysuperservice' });

    const options: ExtendedPubSubOptions = instance.getOptions();
    const config: SQS.Types.ClientConfiguration = instance.getClientConfig();

    expect(config).toBeDefined();
    expect(options).toBeDefined();
    expect(instance.init).toBeDefined();
  });
});
