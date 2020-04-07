jest.mock('aws-sdk');
import { SQS } from 'aws-sdk';
import { SNSSQSPubSub, ExtendedPubSubOptions } from '..';

describe('sqs-pub-sub', () => {
  it('should create an instance', async () => {
    const instance = new SNSSQSPubSub({}, { serviceName: 'mysuperservice' });

    expect(instance).toBeDefined();
  });

  it('can call', async () => {
    const instance = new SNSSQSPubSub({}, { serviceName: 'mysuperservice', prefix: 'myprefix' });

    const options: ExtendedPubSubOptions = instance.getOptions();
    const config: SQS.Types.ClientConfiguration = instance.getClientConfig();
    console.log(config);
    expect(config).toBeDefined();
    expect(options).toBeDefined();
    expect(instance.init).toBeDefined();
  });
});
