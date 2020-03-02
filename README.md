# graphql-snssqs-subscriptions

This package implements the PubSubEngine Interface from the [graphql-subscriptions](https://github.com/apollographql/graphql-subscriptions) package. Once initiated this library automatically create subscriptions between SNS and SQS by the given configuration.

## Simple usage in graphql context with TypeGraphQL

```
import { MessageAttributes } from 'graphql-snssqs-subscriptions';

class SimpleMessageDTO {
  readonly $name = `${env.APP_DOMAIN}/${env.MY_SERVICE_NAME}/message-subject-or-anything`;
  readonly $version = 1;

  msgDataString: string;

  constructor(msgDataString: string) {
    this.msgDataString = msgDataString;
  }
}

export class Resolver {
  Mutation(() => UpdateSomethingResponse)
  async updateSomething(
    @Ctx() ctx: MyServiceContext,
    @Arg('input') inputData: UpdateSomethigInput
  ): Promise<UpdateSomethingResponse> {

    // ... some logic...

    ctx.pubSub.publish(
      env.MY_SERVICE_NAME, // this is your topic
      new SimpleMessageDTO({
        msgDataString: 'some data in message',
      }),
      new MessageAttributes({
        correlationId: `${ctx.account.id}`,
      })
    );

    return UpdateSomethingResponse(true);
  }

  @Subscription(() => Notification, { topics: env.MY_SERVICE_NAME, nullable: true })
  simpleSubscription (@Root() { msgDataString }: NotificationPayload) {
    return { msgDataString };
  }
}
```

## Simple usage with TypeGraphQL and @node-ts/bus-workflow

- More Info on graphql framework [TypeGraphQL]https://typegraphql.ml/docs/introduction.html
- More Info on service bus framework [@node-ts/bus]https://github.com/node-ts/bus

Ilustrated example:

```
// Service1 Resover
import { MessageAttributes } from 'graphql-snssqs-subscriptions';

class SimpleMessageDTO {
  readonly $name = `${env.APP_DOMAIN}/${env.MY_SERVICE_NAME}/message-subject-or-anything`;
  readonly $version = 1;

  msgDataString: string;

  constructor(msgDataString: string) {
    this.msgDataString = msgDataString;
  }
}

export class Resolver {
  Mutation(() => UpdateSomethingResponse)
  async updateSomething(
    @Ctx() ctx: MyServiceContext,
    @Arg('input') inputData: UpdateSomethigInput
  ): Promise<UpdateSomethingResponse> {

    // ... some logic...

    // Methods publish, sendEvent, sendCommand
    ctx.pubSub.sendEvent(
      new SimpleMessageDTO({
        msgDataString: 'some data in message',
      }),
      new MessageAttributes({
        correlationId: `${ctx.account.id}`,
      })
    );

    return UpdateSomethingResponse(true);
  }
}
```

```
// Service2 Workflows
...imports
class SimpleMessageDTO {
  readonly $name = `${env.APP_DOMAIN}/${env.MY_SERVICE_NAME}/message-subject-or-anything`;
  readonly $version = 1;

  msgDataString: string;

  constructor(msgDataString: string) {
    super();
    this.msgDataString = msgDataString;
  }
}

@injectable()
export class MyWorkflow extends Workflow<MyWorkflowData> {
  constructor(
    @inject(BUS_SYMBOLS.Bus) private readonly bus: Bus,
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger
  ) {
    super();
  }

  /**
   * Starts a new workflow when a account has signed up
   */
  @StartedBy<SimpleMessageDTO, MyWorkflowData, 'handleSimpleMessage'>(
    SimpleMessageDTO
  )
  async handlesSimpleMessage(
    event: SimpleMessageDTO,
    _: MyWorkflowData,
    messageAttributes: MessageAttributes
  ): Promise<Partial<MyWorkflowData>> {
    const { msgDataString } = event;

    this.bus.send(new SomeOtherMessageDto())

    return {
      msgDataString,
      correlationId: messageAttributes.correlationId,
    };
  }

  @Handles<
    SomeOtherMessageDto,
    MyWorkflowData,
    'someNewMessageHandler'
  >(SomeOtherMessageDto, (event, attributes) => attributes.correlationId, 'correlationId')
  someNewMessageHandler(): Partial<MyWorkflowData> {
    // Do whatever in this message handler
    this.bus.publish(new MessageToSomeIntegrationServiceMaybe());
    this.complete();
  }
}

```

## Benefits

- Automatically creates subscriptions from SNS to SQS.
- Automatically creates Dead Letter Queues.
- Automatically maps MessageAttributes
- Fully compatable with [@node-ts/bus]https://www.npmjs.com/package/node-ts package
- Typescript Based

## Contributing

Bug reports and pull requests are welcome on GitHub at https://github.com/cto2bOpenSource/graphql-snssqs-subscriptions/issues. This project is intended to be a safe, welcoming space for collaboration, and contributors are expected to adhere to the [Contributor Covenant](http://contributor-covenant.org) code of conduct.

## License

The gem is available as open source under the terms of the [MIT License](https://opensource.org/licenses/MIT).

## Code of Conduct

Everyone interacting in the graphql-snssqs-subscriptions project’s codebases, issue trackers, chat rooms and mailing lists is expected to follow the [code of conduct](https://github.com/cto2bOpenSource/graphql-snssqs-subscriptions/blob/master/CODE_OF_CONDUCT.md).
