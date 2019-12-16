// import { SNSSQSPubSub } from '../../src/index';

// describe('sqs-pub-sub integration', () => {
//   it('work', async done => {
//     const instance = new SNSSQSPubSub(
//       {
//         region: 'us-east-2',
//         sns: {
//           endpoint: `http://localhost:4575`
//         },
//         sqs: {
//           endpoint: `http://localhost:4576`
//         }
//       },
//       { serviceName: 'mySuperSer' }
//     );

//     await instance.init();

//     await instance.publish('mysuperservicea', {
//       data: {
//         data: {
//           test: 4
//         }
//       }
//     });

//     await instance.subscribe('mysuperservicea', data => {
//       console.log('response', data);
//       if (data && data.data && data.data.data && data.data.data.test === 4) {
//         instance.unsubscribe();
//         done();
//       }
//     });
//   });
// });
