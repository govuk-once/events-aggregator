import { Colors, execute } from './helpers';

const tasks = {
  [Colors.purple('tsc')]: 'tsc -w',
  [Colors.orange('cdk')]: 'cdk watch --hotswap',
};

await Promise.all(
  Object.entries(tasks).map(([label, cmd]) => execute(label, cmd.split(' '))),
);
