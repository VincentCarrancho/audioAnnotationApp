import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('check_native_smoke', pathlib.Path(__file__).with_name('check-native-smoke.py'))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def event(name, mount='first'):
    return f'wavnotes-smoke: [DEBUG-wav-smoke] {{"event":"{name}","mount":"{mount}"}}\n'


class NativeSmokeCheckerTest(unittest.TestCase):
    def test_rejects_reported_symptom(self):
        self.assertEqual(checker.classify([], ['wavnotes-smoke: error The operation is not supported.\n'])[0], 'FAIL')

    def test_incomplete_run_is_not_success(self):
        self.assertEqual(checker.classify([event('wave:ready'), event('wave:finish')], [])[0], 'INCONCLUSIVE')

    def test_requires_replay_and_reload(self):
        first = [event('wave:ready'), event('wave:finish'), event('wave:finish')]
        restart = [event('wave:ready', 'second'), event('wave:finish', 'second'), event('wave:finish', 'second'), event('click:reload', 'second'), event('wave:ready', 'third'), event('wave:finish', 'third')]
        self.assertEqual(checker.classify(first, restart)[0], 'PASS')
        self.assertEqual(checker.classify(first, first)[0], 'INCONCLUSIVE')


if __name__ == '__main__':
    unittest.main()
