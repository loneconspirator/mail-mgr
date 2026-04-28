import { assertGreenMailRunning } from './helpers.js';

export default async function setup(): Promise<void> {
  await assertGreenMailRunning();
}
