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
Object.defineProperty(exports, "__esModule", { value: true });
const __1 = require("..");
const triggerName = 'mytestservicetriggernameaaa';
class SimpleMessage extends __1.Message {
    constructor(test) {
        super();
        this.$name = `mydomain/${triggerName}/some-msg-subject`;
        this.test = test;
    }
}
describe('sns-sqs-pub-sub basic integraiton', () => {
    it('should work', (done) => __awaiter(void 0, void 0, void 0, function* () {
        const instance = new __1.SNSSQSPubSub({
            region: 'us-east-2',
            sns: {
                endpoint: `http://localhost:4575`,
            },
            sqs: {
                endpoint: `http://localhost:4576`,
            },
        }, { serviceName: triggerName });
        yield instance.init();
        yield instance.publish(triggerName, new SimpleMessage('test'), new __1.MessageAttributes({
            attributes: {
                stringAttr: 'string',
                numberAttr: 1.24,
            },
            correlationId: 'some-correlation-id-1',
            stickyAttributes: {
                stickyStrAttr: 'string',
                stickyNumberAttr: 123,
            },
        }));
        yield instance.subscribe(triggerName, (data) => {
            expect(data).toBeDefined();
            instance.unsubscribe();
            done();
        });
    }));
});
//# sourceMappingURL=basic.integration.test.js.map