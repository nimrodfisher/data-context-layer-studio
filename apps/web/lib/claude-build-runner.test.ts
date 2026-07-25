import { describe, expect, it } from 'vitest';

import { claudeBuildPrompt, previewFromFiles, resolveClaudeBinary } from './claude-build-runner';

describe('claude build runner helpers', () => {
  it('explains a missing Claude binary clearly via resolve', async () => {
    const missing = await resolveClaudeBinary({
      CONTEXT_LAYER_CLAUDE_BIN: 'C:\\definitely-missing-claude-binary-xyz.exe',
      PATH: '',
    } as unknown as NodeJS.ProcessEnv);
    expect(missing).toBeUndefined();
  });

  it('builds a concise CLI prompt pointing at the pack', () => {
    expect(claudeBuildPrompt('customer-health')).toContain('out/customer-health/');
    expect(claudeBuildPrompt('customer-health')).toContain('PROMPT.md');
  });

  it('extracts preview files from a polished map', () => {
    const preview = previewFromFiles(
      {
        'demo/SKILL.md': '# Demo\n',
        'demo/guardrails.md': '# Guardrails\n',
        'demo/other.md': 'skip\n',
      },
      'demo',
    );
    expect(preview['SKILL.md']).toContain('Demo');
    expect(preview['guardrails.md']).toContain('Guardrails');
    expect(preview['other.md']).toBeUndefined();
  });
});
