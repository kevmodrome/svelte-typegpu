import type { Reporter } from 'vitest/reporters';

export default class ErrorReporter implements Reporter {
  onTestRunEnd: Reporter['onTestRunEnd'] = (modules, errors) => {
    process.stdout.write(
      JSON.stringify({
        tests: modules.flatMap((module) =>
          [...module.children.allTests()].map((test) => ({
            name: test.fullName,
            state: test.result().state
          }))
        ),
        errors: errors.map((error) => ({
          name: error.name,
          message: error.message,
          stack: error.stack
        }))
      })
    );
  };
}
