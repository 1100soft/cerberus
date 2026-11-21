"""Execute the prompt's actual approval checks against disposable JSON handoffs."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

DOCS = Path(__file__).resolve().parents[1] / 'docs/automation-prompts'
MARKER = "<<'PY_RELEASE_APPROVAL'\n"
CHECKS = [(DOCS / f'{role}.md').read_text().split(MARKER, 1)[1].split('\nPY_RELEASE_APPROVAL', 1)[0] for role in ('review', 'integrate', 'publish')]
assert CHECKS[0] == CHECKS[1] == CHECKS[2], 'Release contract checks differ between agents'


class ReleaseProvenance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.approval = {
            'reviewRun': 'review-fixture', 'reviewedSha': 'a' * 40,
            'documentationReviewed': True, 'documentationPaths': ['README.md'],
            'variables': {'release': True},
            'releasePlan': {'schema': 1, 'requestRun': 'request-fixture',
                'remoteName': 'origin', 'remoteUrl': 'https://example.invalid/repo.git',
                'sourceBranch': 'development', 'sourceSha': 'b' * 40,
                'targetBranch': 'stable', 'previousTargetSha': 'c' * 40,
                'tag': 'v1.2.3', 'sourceTag': 'source/v1.2.3', 'progressLevel': 'patch'},
        }

    def check(self, output, original=None, success=True):
        stage = self.root / 'staged.json'
        final = self.root / ('review-fixture.txt' if original is None else 'publish-fixture.txt')
        final.unlink(missing_ok=True)
        stage.write_text(json.dumps(output))
        incoming = self.root / 'incoming.json'
        if original is not None:
            incoming.write_text(json.dumps(original))
        result = subprocess.run([sys.executable, '-', 'review' if original is None else 'forward', str(stage), '-' if original is None else str(incoming), str(final)], input=CHECKS[0], text=True, capture_output=True, env={**os.environ, 'CERBERUS_ACTIVITY_RUN_ID': 'review-fixture'})
        self.assertEqual(result.returncode == 0, success, result.stderr)
        self.assertEqual(final.exists(), success, 'Invalid approval reached an emitted handoff path')
        if success:
            self.assertEqual(json.loads(final.read_text()), output)
            self.assertFalse(stage.exists())
        else:
            self.assertTrue(stage.exists())

    def test_review_assigns_its_own_run_and_publishes_atomically(self):
        self.check(self.approval)
        for bad in (None, '', 'different-review'):
            with self.subTest(reviewRun=bad):
                output = copy.deepcopy(self.approval); output['reviewRun'] = bad
                self.check(output, success=False)

    def test_forward_preserves_the_complete_contract(self):
        self.check(self.approval, self.approval)
        for field in ('reviewRun', 'reviewedSha', 'documentationPaths', 'releasePlan'):
            with self.subTest(field=field):
                output = copy.deepcopy(self.approval)
                output[field] = {'tag': 'v9.9.9'} if field == 'releasePlan' else ['OTHER.md'] if field == 'documentationPaths' else 'd' * 40 if field == 'reviewedSha' else 'different-review'
                self.check(output, self.approval, success=False)
        for bad in (None, ''):
            original = copy.deepcopy(self.approval); original['reviewRun'] = bad
            self.check(self.approval, original, success=False)

    def test_requires_documentation_and_the_original_target(self):
        for field, value in [('documentationReviewed', False), ('documentationPaths', []), ('documentationPaths', ['../outside']), ('reviewedSha', 'partial')]:
            output = copy.deepcopy(self.approval); output[field] = value
            self.check(output, success=False)
        output = copy.deepcopy(self.approval); del output['releasePlan']['previousTargetSha']
        self.check(output, success=False)
        output['releasePlan']['previousTargetSha'] = ''
        self.check(output)

    def test_verified_wrapped_plan_is_normalized_without_loss(self):
        original = copy.deepcopy(self.approval)
        original['release'] = {'releasePlan': original.pop('releasePlan')}
        self.check(self.approval, original)

    def test_release_ready_requires_exact_publication_and_publish_run(self):
        output = copy.deepcopy(self.approval)
        output.update(sourcePublished=True, publishedSha=output['reviewedSha'], publishRun='publish-fixture')
        output['variables']['releaseReady'] = True
        self.check(output, self.approval)
        for field, value in [('sourcePublished', False), ('publishedSha', 'd' * 40), ('publishRun', None)]:
            bad = copy.deepcopy(output); bad[field] = value
            self.check(bad, self.approval, success=False)


if __name__ == '__main__':
    unittest.main()
