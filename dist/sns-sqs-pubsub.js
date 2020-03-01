"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bus_messages_1 = require("@node-ts/bus-messages");
const sqs_transport_1 = require("@node-ts/bus-sqs/dist/sqs-transport");
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const pubsub_async_iterator_1 = require("graphql-subscriptions/dist/pubsub-async-iterator");
const debug_1 = __importDefault(require("debug"));
const debug = debug_1.default('gql-snssqs-subscriptions');
const MILLISECONDS_IN_SECONDS = 1000;
const AWS_SDK_SQS_API_VERSION = '2012-11-05';
const AWS_SDK_SNS_API_VERSION = '2010-03-31';
class SNSSQSPubSub {
    constructor(config = {}, pubSubOptions) {
        this.options = {
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
        this.init = () => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.createPubSub();
                debug('Pubsub Engine is created and has these options :', this.options);
            }
            catch (error) {
                debug('Pubsub Engine failed to create ', this.options, error);
                return undefined;
            }
        });
        this.asyncIterator = (triggers) => {
            return new pubsub_async_iterator_1.PubSubAsyncIterator(this, triggers);
        };
        this.getOptions = () => (Object.assign({}, this.options));
        this.getClientConfig = () => (Object.assign({}, this.clientConfig));
        this.setupPolicies = (queueName) => {
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
        this.subscribe = (triggerName, onMessage) => {
            try {
                this.pollMessage(triggerName, onMessage);
                return Promise.resolve(1);
            }
            catch (error) {
                debug('Error happens before starting to poll', error);
                return Promise.resolve(0);
            }
        };
        this.unsubscribe = () => __awaiter(this, void 0, void 0, function* () {
            if (!this.options.stopped) {
                this.options.stopped = true;
            }
        });
        this.pollMessage = (topic, onMessage) => __awaiter(this, void 0, void 0, function* () {
            if (this.options.stopped) {
                return;
            }
            const params = {
                QueueUrl: this.options.queueUrl,
                WaitTimeSeconds: 10,
                MaxNumberOfMessages: 1,
                MessageAttributeNames: ['.*'],
                AttributeNames: ['ApproximateReceiveCount'],
            };
            const result = yield this.sqs.receiveMessage(params).promise();
            if (!result.Messages || result.Messages.length === 0) {
                return;
            }
            // Only handle the expected number of messages, anything else just return and retry
            if (result.Messages.length > 1) {
                debug('Received more than the expected number of messages', {
                    expected: 1,
                    received: result.Messages.length,
                });
                yield Promise.all(result.Messages.map((message) => __awaiter(this, void 0, void 0, function* () { return this.makeMessageVisible(message); })));
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
                const snsMessage = JSON.parse(sqsMessage.Body);
                if (!snsMessage.Message) {
                    debug('Message is not formatted with an SNS envelope and will be discarded', {
                        sqsMessage,
                    });
                    yield this.deleteMessage(sqsMessage);
                    return;
                }
                const domainMessage = JSON.parse(snsMessage.Message);
                if (this.resolveTopicFromMessageName(domainMessage.$name) !== topic) {
                    debug('message.$name does not have same topic');
                    return;
                }
                const attributes = sqs_transport_1.fromMessageAttributeMap(snsMessage.MessageAttributes);
                debug('Received message attributes', {
                    transportAttributes: snsMessage.MessageAttributes,
                    messageAttributes: attributes,
                });
                yield this.deleteMessage(sqsMessage);
                onMessage({
                    id: sqsMessage.MessageId,
                    raw: sqsMessage,
                    domainMessage,
                    attributes,
                });
            }
            catch (error) {
                debug("Could not parse message. Message will be retried, though it's likely to end up in the dead letter queue", { sqsMessage, error });
                yield this.makeMessageVisible(sqsMessage);
                return;
            }
        });
        this.createPubSub = () => __awaiter(this, void 0, void 0, function* () {
            // Create SNS Topic and SQS Queue
            try {
                if (this.options.withSNS) {
                    yield this.createTopic();
                }
                yield this.createQueue();
            }
            catch (error) {
                debug(`Unable to configure PubSub channel ${error}`);
            }
            if (!this.options.withSNS) {
                return;
            }
            // Subscribe SNS Topic to SQS Queue
            try {
                const { SubscriptionArn } = yield this.sns
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
                this.options.subscriptionArn = SubscriptionArn;
            }
            catch (error) {
                debug(`Unable to subscribe with these options ${this.options}, error: ${error}`);
                return undefined;
            }
            // Persist available topics in the options
            try {
                const { Topics } = yield this.sns.listTopics().promise();
                this.options.availableTopicsList = Topics;
            }
            catch (error) {
                debug(`Unable to fetch topics, might be problem when publishing messages ${this.options}, error ${error}`);
                return undefined;
            }
        });
        this.createTopic = () => __awaiter(this, void 0, void 0, function* () {
            const { serviceName } = this.options;
            try {
                const { TopicArn } = yield this.sns.createTopic({ Name: `${serviceName}` }).promise();
                this.options.topicArn = TopicArn;
            }
            catch (error) {
                debug(`Topic creation failed. ${error}`);
                return undefined;
            }
        });
        this.createQueue = () => __awaiter(this, void 0, void 0, function* () {
            const queueName = this.formQueueName();
            const queueNameeDLQ = this.formQueueName('-DLQ');
            const policy = {
                Policy: JSON.stringify(this.setupPolicies(queueName)),
                RedrivePolicy: `{"deadLetterTargetArn":"${this.options.dlQueueArn}","maxReceiveCount":"10"}`,
            };
            const params = {
                QueueName: queueName,
                Attributes: Object.assign({}, policy),
            };
            const paramsDLQ = {
                QueueName: queueNameeDLQ,
            };
            try {
                const dlqQueueResult = yield this.sqs.createQueue(paramsDLQ).promise();
                const queuResult = yield this.sqs.createQueue(params).promise();
                this.options.queueUrl = queuResult.QueueUrl;
                this.options.dlQueueUrl = dlqQueueResult.QueueUrl;
            }
            catch (error) {
                debug(`Queue creation failed. ${error}`);
                return undefined;
            }
        });
        this.deleteMessage = (sqsMessage) => __awaiter(this, void 0, void 0, function* () {
            const params = {
                QueueUrl: this.options.queueUrl,
                ReceiptHandle: sqsMessage.ReceiptHandle,
            };
            try {
                yield this.sqs.deleteMessage(params).promise();
            }
            catch (error) {
                debug(`Unable to delete message ${error}`);
                return;
            }
        });
        this.formQueueName = (providedSuffix) => {
            const { serviceName } = this.options;
            const queuePrefix = process.env.NODE_ENV == 'production'
                ? ''
                : process.env.NODE_ENV === 'test'
                    ? 'test-'
                    : 'development-';
            const queueRoot = serviceName;
            return `${queuePrefix}${queueRoot}${providedSuffix || ''}`;
        };
        this.resolveTopicArnFromMessageName = (topic) => {
            // if provided topic arn resolve fn
            if (this.options.topicArnResolverFn) {
                return this.options.topicArnResolverFn(topic);
            }
            // topic is itself service
            if (topic === this.options.serviceName) {
                return this.options.topicArn;
            }
            // find topic by topic name in the topics list
            const result = this.options.availableTopicsList.filter((topic) => {
                const topicParts = topic.TopicArn.split(':');
                const topicName = topicParts[5];
                return topicName === topic;
            });
            // return found topic or return given argument
            return !!result ? result[0].TopicArn : topic;
        };
        this.resolveTopicFromMessageName = (messageName) => {
            return !!this.options.topicResolverFn
                ? this.options.topicResolverFn(messageName)
                : messageName.split('/')[1];
        };
        this.calculateVisibilityTimeout = (sqsMessage) => {
            const currentReceiveCount = parseInt((sqsMessage.Attributes && sqsMessage.Attributes.ApproximateReceiveCount) || '0', 10);
            const numberOfFailures = currentReceiveCount + 1;
            const delay = 5 ^ numberOfFailures; // Delays from 5ms to ~2.5 hrs
            return delay / MILLISECONDS_IN_SECONDS;
        };
        this.attributesToComplyNodeBus = (sqsAttributes) => {
            let attributes = {};
            Object.keys(sqsAttributes).forEach(key => {
                const attribute = sqsAttributes[key];
                attributes[key] = {
                    Type: attribute.DataType,
                    Value: attribute.StringValue,
                };
            });
            return attributes;
        };
        aws_sdk_1.default.config.update(config);
        this.clientConfig = config;
        this.options = Object.assign(Object.assign({}, this.options), pubSubOptions);
        this.sqs = new aws_sdk_1.default.SQS();
        if (this.options.withSNS) {
            this.sns = new aws_sdk_1.default.SNS();
        }
        debug('Pubsub Engine is configured with :', this.options);
        debug('Pubsub Engine client is configured with :', this.clientConfig);
    }
    // generic pubsub engine publish method, still works with @node-ts/bus Event/Command
    publish(triggerName, message, messageAttributes) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.resolveTopicFromMessageName(message.$name) !== triggerName) {
                console.error('triggerName should be found in message.$name, message was not published.');
                return;
            }
            yield this.publishMessage(message, messageAttributes);
        });
    }
    // same as publish but specific for @node-ts/bus Event
    sendEvent(event, messageAttributes) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.publishMessage(event, messageAttributes);
        });
    }
    // same as publish but specific for @node-ts/bus Command
    sendCommand(command, messageAttributes) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.publishMessage(command, messageAttributes);
        });
    }
    publishMessage(message, messageAttributes = new bus_messages_1.MessageAttributes()) {
        return __awaiter(this, void 0, void 0, function* () {
            const topicName = this.resolveTopicFromMessageName(message.$name);
            const topicArn = this.resolveTopicArnFromMessageName(topicName);
            debug('Publishing message to sns', { message, topicArn });
            const attributeMap = sqs_transport_1.toMessageAttributeMap(messageAttributes);
            debug('Resolved message attributes', { attributeMap });
            const snsEnvelope = {
                Message: JSON.stringify(message),
                MessageAttributes: this.attributesToComplyNodeBus(attributeMap),
            };
            const snsMessage = {
                TopicArn: topicArn,
                Subject: message.$name,
                Message: JSON.stringify(snsEnvelope),
                MessageAttributes: attributeMap,
            };
            debug('Sending message to SNS', { snsMessage });
            yield this.sns.publish(snsMessage).promise();
        });
    }
    makeMessageVisible(sqsMessage) {
        return __awaiter(this, void 0, void 0, function* () {
            const changeVisibilityRequest = {
                QueueUrl: this.options.queueUrl,
                ReceiptHandle: sqsMessage.ReceiptHandle,
                VisibilityTimeout: this.calculateVisibilityTimeout(sqsMessage),
            };
            yield this.sqs.changeMessageVisibility(changeVisibilityRequest).promise();
        });
    }
}
exports.SNSSQSPubSub = SNSSQSPubSub;
//# sourceMappingURL=sns-sqs-pubsub.js.map