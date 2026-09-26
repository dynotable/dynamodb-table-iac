// A DynamoDB endpoint that answers every request with ResourceNotFoundException,
// so `terraform plan` of a NEW table succeeds offline: the hashicorp/aws provider
// calls DescribeTable during planning (measured on 6.29 and 6.66) and a
// connection refusal fails the plan.
//
//   node scripts/ddb-stub.ts <port>
//
// Prints `listening <port>` once bound; scripts/validate-terraform.ts spawns it
// and waits for that line.
import {createServer} from 'node:http';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) throw new Error('usage: node scripts/ddb-stub.ts <port>');

const body = JSON.stringify({
  __type: 'com.amazonaws.dynamodb.v20120810#ResourceNotFoundException',
  message: 'Requested resource not found'
});

createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(400, {'content-type': 'application/x-amz-json-1.0'});
    res.end(body);
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`listening ${port}`);
});
