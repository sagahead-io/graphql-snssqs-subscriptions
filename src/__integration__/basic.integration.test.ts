import { SNSSQSPubSub, Message, MessageAttributes } from '..';

const triggerName = 'mytestservicetriggernameaaa';

class SimpleMessage extends Message {
  $name = `mydomain/${triggerName}/some-msg-subject`;

  test: string;

  constructor(test: string) {
    super();
    this.test = test;
  }
}

describe('sns-sqs-pub-sub basic integraiton', () => {
  it('should work', async done => {
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
      { serviceName: triggerName }
    );
    await instance.init();
    await instance.publish(
      triggerName,
      new SimpleMessage('test'),
      new MessageAttributes({
        attributes: {
          stringAttr: 'string',
          numberAttr: 1.24,
        },
        correlationId: 'some-correlation-id-1',
        stickyAttributes: {
          stickyStrAttr: 'string',
          stickyNumberAttr: 123,
        },
      })
    );
    await instance.subscribe(triggerName, (data: any) => {
      expect(data).toBeDefined();
      instance.unsubscribe();
      done();
    });
  });
});
