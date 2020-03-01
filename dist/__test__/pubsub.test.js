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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('aws-sdk');
const AWS = __importStar(require("aws-sdk-mock"));
const __1 = require("..");
const CreateTopicResult = {
    TopicArn: 'arn:aws:sns:region:id:TEST_TOPIC_NAME',
};
const CreateQueueResult = {
    QueueUrl: 'https://sqs.region.amazonaws.com/id/testQueueName',
};
const GeQueueAttrResult = {
    Attributes: {
        QueueArn: 'arn:aws:sns:region:id:testQueueArn',
    },
};
const SubscriptionResult = {
    SubscriptionArn: 'arn:aws:sns:region:id:TEST_TOPIC_NAME:uuid',
};
const ListTopicResult = {
    Topics: [CreateTopicResult],
};
describe('sqs-pub-sub', () => {
    beforeEach(() => {
        AWS.mock('SNS', 'createTopic', (params, callback) => {
            callback(null, CreateTopicResult);
        });
        AWS.mock('SQS', 'createQueue', (params, callback) => {
            callback(null, CreateQueueResult);
        });
        AWS.mock('SQS', 'getQueueAttributes', (params, callback) => {
            callback(null, GeQueueAttrResult);
        });
        AWS.mock('SNS', 'subscribe', (params, callback) => {
            callback(null, SubscriptionResult);
        });
        AWS.mock('SNS', 'listTopics', (params, callback) => {
            callback(null, ListTopicResult);
        });
    });
    afterEach(() => {
        AWS.restore();
    });
    it('should create an instance', () => __awaiter(void 0, void 0, void 0, function* () {
        const instance = new __1.SNSSQSPubSub({}, { serviceName: 'mysuperservice' });
        expect(instance).toBeDefined();
    }));
    it('can call', () => __awaiter(void 0, void 0, void 0, function* () {
        const instance = new __1.SNSSQSPubSub({}, { serviceName: 'mysuperservice' });
        const options = instance.getOptions();
        const config = instance.getClientConfig();
        expect(config).toBeDefined();
        expect(options).toBeDefined();
        expect(instance.init).toBeDefined();
    }));
});
//# sourceMappingURL=pubsub.test.js.map