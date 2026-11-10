#!/usr/bin/env python3
"""Exercise the documented publisher against disposable local remotes only."""
import os
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'docs/automation-prompts/release.sh'


def git(path, *args):
    return subprocess.check_output(['git', '-C', str(path), *args], stderr=subprocess.PIPE, text=True).strip()


class ReleasePublisher(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.remote = self.root / 'remote.git'
        git(self.root, 'init', '--bare', '-q', str(self.remote))
        git(self.repo, 'init', '-q', '-b', 'wip')
        git(self.repo, 'config', 'user.name', 'Fixture')
        git(self.repo, 'config', 'user.email', 'fixture@example.test')
        git(self.repo, 'remote', 'add', 'origin', str(self.remote))
        (self.repo / 'version').write_text('1.2.3')
        self.commit('existing history')
        git(self.repo, 'branch', 'main')
        git(self.repo, 'tag', 'v1.2.3')
        git(self.repo, 'push', '-q', 'origin', 'wip', 'main', 'v1.2.3')
        self.base = git(self.repo, 'rev-parse', 'HEAD')
        self.handoff = self.root / 'handoff.json'
        self.env = {**os.environ, 'CERBERUS_INPUT_PROGRESS_LEVEL': 'patch',
                    'CERBERUS_HANDOFF_RELEASE': str(self.handoff), 'CERBERUS_RUN_ID': 'release-fixture', 'GIT_TERMINAL_PROMPT': '0'}
        # Do not inherit per-user release overrides in the fixture.
        for key in list(self.env):
            if key.startswith('CERBERUS_RELEASE_'):
                self.env.pop(key)

    def commit(self, message):
        git(self.repo, 'add', '.')
        git(self.repo, 'commit', '-qm', message)

    def prepare(self, version='1.2.4', hook=True):
        (self.repo / 'version').write_text(version)
        if hook:
            check = self.repo / 'app/scripts/check-version.mjs'
            check.parent.mkdir(parents=True)
            check.write_text("import fs from 'node:fs'; if ('v'+fs.readFileSync('version','utf8').trim() !== process.env.RELEASE_TAG) throw Error('version mismatch');\n")
        self.commit('prepare source')
        git(self.repo, 'push', '-q', 'origin', 'wip')
        return git(self.repo, 'rev-parse', 'HEAD')

    def run_release(self, approved=True):
        env = dict(self.env)
        if approved:
            env.update(CERBERUS_RELEASE_APPROVED_SHA=git(self.repo, 'rev-parse', 'HEAD'),
                       CERBERUS_RELEASE_EXPECTED_SOURCE=self.remote_git('rev-parse', 'refs/heads/wip'),
                       CERBERUS_RELEASE_EXPECTED_TARGET=self.base,
                       CERBERUS_RELEASE_ORIGINAL_SOURCE=self.base,
                       CERBERUS_RELEASE_TAG='v1.2.4', CERBERUS_RELEASE_REQUEST_RUN='release-fixture')
        return subprocess.run(['bash', str(SCRIPT)], cwd=self.repo, env=env,
                              text=True, capture_output=True, timeout=30)

    def remote_git(self, *args):
        # Explicit selection works with safe.bareRepository=explicit.
        return subprocess.check_output(
            ['git', '--git-dir', str(self.remote), *args],
            stderr=subprocess.PIPE, text=True).strip()

    def refs(self):
        return self.remote_git('show-ref')

    def test_manual_request_always_requests_agent_documentation(self):
        self.prepare()  # Numeric validation alone must never bypass the agent.
        before = self.refs()
        result = self.run_release(approved=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('AWAITING_RELEASE_PREPARATION', result.stdout)
        self.assertIn('Release preparation/publication context.', result.stdout)
        self.assertNotIn('Release preparation/publication context.', result.stderr)
        self.assertEqual(self.refs(), before)
        plan = json.loads(self.handoff.read_text())['releasePlan']
        self.assertEqual(plan['tag'], 'v1.2.4')
        self.assertEqual(plan['sourceSha'], self.remote_git('rev-parse', 'refs/heads/wip'))
        self.assertEqual(plan['previousTargetSha'], self.base)
        self.assertEqual(plan['stage'], 'prepare release documentation')

    def test_missing_handoff_cannot_bypass_preparation(self):
        self.prepare()
        self.env.pop('CERBERUS_HANDOFF_RELEASE')
        before = self.refs()
        result = self.run_release(approved=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.refs(), before)

    def test_reviewed_documentation_is_in_both_release_and_development(self):
        source = self.prepare()
        (self.repo / 'CHANGELOG.md').write_text('# 1.2.4\nReviewed release notes.\n')
        self.commit('prepare reviewed release documentation')
        approved = git(self.repo, 'rev-parse', 'HEAD')
        self.assertEqual(self.remote_git('rev-parse', 'refs/heads/wip'), source)
        git(self.repo, 'push', '-q', 'origin', 'wip')  # Integrate/Publish precedes release.
        result = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.remote_git('rev-parse', 'refs/heads/wip'), approved)
        release = self.remote_git('rev-parse', 'refs/heads/main')
        self.assertEqual(self.remote_git('show', release+':CHANGELOG.md'), '# 1.2.4\nReviewed release notes.')
        self.assertEqual(self.remote_git('rev-list', '--parents', '-n', '1', release), release+' '+self.base)
        self.assertEqual(self.remote_git('rev-parse', 'refs/tags/cerberus/source/v1.2.4^{}'), approved)

    def test_publish_requires_documentation_approval(self):
        self.prepare()
        self.assertEqual(self.run_release(approved=False).returncode, 0)
        plan = json.loads(self.handoff.read_text())['releasePlan']
        payload = self.root / 'approved.json'
        approval = {'releasePlan': plan, 'reviewedSha': git(self.repo, 'rev-parse', 'HEAD'),
                    'reviewRun': 'review-fixture', 'documentationPaths': ['version'],
                    'variables': {'release': True, 'releaseReady': True}, 'documentationReviewed': False,
                    'sourcePublished': True, 'publishedSha': git(self.repo, 'rev-parse', 'HEAD'), 'publishRun': 'publish-fixture'}
        payload.write_text(json.dumps(approval))
        env = {**self.env, 'CERBERUS_HANDOFF_INPUT': str(payload)}
        publisher = SCRIPT.with_name('release-publish.sh')
        before = self.refs()
        result = subprocess.run(['bash', str(publisher)], cwd=self.repo, env=env, text=True, capture_output=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.refs(), before)
        approval['documentationReviewed'] = True
        approval['sourcePublished'] = False
        payload.write_text(json.dumps(approval))
        result = subprocess.run(['bash', str(publisher)], cwd=self.repo, env=env, text=True, capture_output=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.refs(), before)
        self.assertIn("Publish's verification", result.stderr)
        approval['sourcePublished'] = True
        payload.write_text(json.dumps(approval))
        result = subprocess.run(['bash', str(publisher)], cwd=self.repo, env=env, text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('RELEASED v1.2.4', result.stdout)

    def test_unpublished_preparation_cannot_be_released(self):
        self.prepare()
        original = self.remote_git('rev-parse', 'refs/heads/wip')
        (self.repo / 'CHANGELOG.md').write_text('Release notes still local')
        self.commit('chore(release): prepare v1.2.4')
        before = self.refs()
        result = self.run_release()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('must be published', result.stderr)
        self.assertEqual(self.refs(), before)
        self.assertEqual(self.remote_git('rev-parse', 'refs/heads/wip'), original)

    def test_stale_approval_does_not_publish(self):
        self.prepare()
        self.assertEqual(self.run_release(approved=False).returncode, 0)
        plan = json.loads(self.handoff.read_text())['releasePlan']
        approved = git(self.repo, 'rev-parse', 'HEAD')
        (self.repo / 'new-work').write_text('concurrent development')
        self.commit('concurrent source update')
        git(self.repo, 'push', '-q', 'origin', 'wip')
        payload = self.root / 'stale.json'
        payload.write_text(json.dumps({'releasePlan': plan, 'reviewedSha': approved,
            'reviewRun': 'review-fixture', 'documentationPaths': ['version'],
            'documentationReviewed': True, 'variables': {'release': True, 'releaseReady': True},
            'sourcePublished': True, 'publishedSha': approved, 'publishRun': 'publish-fixture'}))
        before = self.refs()
        result = subprocess.run(['bash', str(SCRIPT.with_name('release-publish.sh'))],
            cwd=self.repo, env={**self.env, 'CERBERUS_HANDOFF_INPUT': str(payload)}, text=True, capture_output=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.refs(), before)
        self.assertIn('Remote source no longer matches', result.stderr)

    def test_unprepared_version_also_goes_to_documentation_agent(self):
        self.prepare('1.2.3')
        before = self.refs()
        result = self.run_release(approved=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.refs(), before)
        self.assertEqual(json.loads(self.handoff.read_text())['releasePlan']['tag'], 'v1.2.4')

    def test_publish_snapshot_uses_current_publisher(self):
        self.assertIn(SCRIPT.read_text(), SCRIPT.with_name('release-publish.sh').read_text())

    def test_version_mismatch_cannot_publish(self):
        self.prepare('1.2.3')
        before = self.refs()
        result = self.run_release()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertEqual(self.refs(), before)
        self.assertIn('validate release version', self.handoff.read_text())
        self.assertIn('version mismatch', result.stderr)

    def test_missing_check_cannot_publish(self):
        self.prepare(hook=False)
        before = self.refs()
        result = self.run_release()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.refs(), before)
        self.assertIn('project-owned release version check', self.handoff.read_text())

    def test_ambiguous_checks_cannot_publish(self):
        self.prepare()
        other = self.repo / 'other/scripts/check-release-version.mjs'
        other.parent.mkdir(parents=True)
        other.write_text('process.exit(0);\n')
        self.commit('ambiguous version checks')
        git(self.repo, 'push', '-q', 'origin', 'wip')
        before = self.refs()
        result = self.run_release()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.refs(), before)
        self.assertIn('project-owned release version check', self.handoff.read_text())

    def test_append_one_commit_and_separate_provenance(self):
        source = self.prepare()
        (self.repo / 'untracked').write_text('leave untouched')
        result = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        release = self.remote_git('rev-parse', 'refs/heads/main')
        self.assertEqual(self.remote_git('rev-list', '--parents', '-n', '1', release), release+' '+self.base)
        self.assertEqual(self.remote_git('rev-parse', release+'^{tree}'), git(self.repo, 'rev-parse', source+'^{tree}'))
        self.assertEqual(self.remote_git('rev-parse', 'refs/tags/v1.2.4^{}'), release)
        self.assertEqual(self.remote_git('rev-parse', 'refs/tags/cerberus/source/v1.2.4^{}'), source)
        self.assertEqual(self.remote_git('rev-parse', 'refs/heads/wip'), source)
        self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), source)
        self.assertEqual((self.repo / 'untracked').read_text(), 'leave untouched')
        self.assertFalse(self.handoff.exists())

    def test_target_race_is_preserved(self):
        self.prepare()
        # A project check simulates a concurrent writer after the snapshot was captured.
        race = self.repo / 'scripts/race.sh'
        race.parent.mkdir()
        race.write_text('git push -q origin refs/remotes/origin/source:refs/heads/main\n')
        self.commit('race fixture')
        git(self.repo, 'push', '-q', 'origin', 'wip')
        source = git(self.repo, 'rev-parse', 'HEAD')
        self.env['CERBERUS_RELEASE_VERSION_CHECK'] = 'scripts/race.sh'
        result = self.run_release()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.remote_git('rev-parse', 'refs/heads/main'), source)
        self.assertIn('Remote target branch changed', self.handoff.read_text())
        self.assertNotIn('refs/tags/v1.2.4', self.refs())


if __name__ == '__main__':
    unittest.main()
