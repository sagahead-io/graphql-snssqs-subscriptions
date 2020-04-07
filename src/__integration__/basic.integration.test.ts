import { SNSSQSPubSub, Message, MessageAttributes, PubSubMessageBody } from '..';

const triggerName = 'service1';

class SimpleMessage extends Message {
  $name = `mydomain/${triggerName}/some-msg-subject`;

  test: string;

  constructor(test: string) {
    super();
    this.test = test;
  }
}

const msg = new SimpleMessage('test');

const attributes = new MessageAttributes({
  attributes: {
    stringAttr: 'string',
    numberAttr: 1.24,
  },
  correlationId: 'some-correlation-id-1',
  stickyAttributes: {
    stickyStrAttr: 'string',
    stickyNumberAttr: 123,
  },
});

describe('sns-sqs-pub-sub basic integraiton', () => {
  it('should work', async (done) => {
    const instance = new SNSSQSPubSub(
      {
        region: 'us-east-2',
        sns: {
          endpoint: `http://localhost:4575`,
        },
        sqs: {
          endpoint: `http://localhost:4576`,
        },
      },
      { serviceName: triggerName, prefix: 'myprefix' }
    );
    await instance.init();
    await instance.publish(triggerName, msg, attributes);
    await instance.subscribe(triggerName, (data: PubSubMessageBody) => {
      console.log(data);
      expect(data.raw.MessageId).toEqual(data.id);
      expect(data.domainMessage).toEqual(new SimpleMessage('test'));
      expect(data.attributes).toEqual(attributes);
      instance.unsubscribe();
      done();
    });
  });
});
