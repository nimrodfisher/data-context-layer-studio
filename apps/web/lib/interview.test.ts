import { describe, expect, it } from 'vitest';

import {
  applyInterviewAnswer,
  createInterviewProgress,
  getInterviewPlan,
  markInterviewAnswered,
  nextInterviewTurn,
} from './interview';
import { createBlankProject } from './project';

describe('interview plan', () => {
  it('covers every authoring step in order with source expectations', () => {
    const plan = getInterviewPlan();
    expect(plan.map(({ stepId }) => stepId)).toEqual([
      'domain',
      'domain',
      'sources',
      'business',
      'business',
      'data',
      'metrics',
      'caveats',
      'governance',
    ]);
    expect(plan.every(({ question, whyItMatters, expectedSourceKinds, acceptanceHints }) =>
      Boolean(
        question.includes('Where') || question.includes('What') || question.includes('Where'),
      ) &&
        whyItMatters.length > 20 &&
        expectedSourceKinds.length > 0 &&
        acceptanceHints.length > 0,
    )).toBe(true);
    expect(plan.find(({ id }) => id === 'metrics-definitions')?.question).toMatch(
      /metric definitions/i,
    );
  });

  it('advances turns from progress and marks completion', () => {
    let progress = createInterviewProgress();
    const first = nextInterviewTurn(progress);
    expect(first.done).toBe(false);
    expect(first.prompt.id).toBe('domain-identity');
    expect(first.index).toBe(0);

    progress = markInterviewAnswered(progress, first.prompt.id);
    const second = nextInterviewTurn(progress);
    expect(second.prompt.id).toBe('domain-owners');

    for (const prompt of getInterviewPlan()) {
      progress = markInterviewAnswered(progress, prompt.id);
    }
    const done = nextInterviewTurn(progress);
    expect(done.done).toBe(true);
    expect(done.index).toBe(getInterviewPlan().length);
  });
});

describe('applyInterviewAnswer', () => {
  it('adds a static source and domain note for a markdown pointer', () => {
    const project = createBlankProject('Customer health', new Date('2026-07-22T10:00:00.000Z'));
    const turn = nextInterviewTurn(createInterviewProgress());
    const result = applyInterviewAnswer(project, turn, {
      sourceKind: 'markdown',
      text: '# Domain brief\nCustomer health covers weekly risk interventions.',
      fileName: 'domain-brief.md',
      sourceName: 'Domain brief',
    });

    expect(result.shouldCollectStatic).toBe(true);
    expect(result.addedSourceId).toBeTruthy();
    expect(result.project.sources.some(({ id }) => id === result.addedSourceId)).toBe(true);
    expect(result.project.domain.identity.description).toContain('Markdown file');
  });

  it('records Snowflake MCP config with table topics without inventing evidence', () => {
    const project = createBlankProject('Customer health', new Date('2026-07-22T10:00:00.000Z'));
    let progress = createInterviewProgress();
    progress = markInterviewAnswered(progress, 'domain-identity');
    progress = markInterviewAnswered(progress, 'domain-owners');
    const turn = nextInterviewTurn(progress);
    expect(turn.prompt.id).toBe('sources-primary');

    const result = applyInterviewAnswer(project, turn, {
      sourceKind: 'snowflake_mcp',
      text: 'Ops analytics warehouse MCP',
      endpoint: 'https://mcp.example.com/snowflake',
      tablesOrTopics: 'ANALYTICS.HEALTH.ACCOUNT_SNAPSHOT, ANALYTICS.HEALTH.TICKETS',
      sourceName: 'Snowflake health MCP',
    });

    expect(result.shouldCollectStatic).toBe(false);
    expect(result.project.evidence).toHaveLength(0);
    const source = result.project.sources.find(({ id }) => id === result.addedSourceId);
    expect(source?.transport).toBe('mcp');
    expect(source?.connection.endpoint).toBe('https://mcp.example.com/snowflake');
    expect(source?.connection.metadata?.tablesOrTopics).toContain('ACCOUNT_SNAPSHOT');
    expect(result.project.clarifications.some(({ status }) => status === 'open')).toBe(true);
  });

  it('applies manual domain identity lines into domain fields', () => {
    const project = createBlankProject('Untitled', new Date('2026-07-22T10:00:00.000Z'));
    const turn = nextInterviewTurn(createInterviewProgress());
    const result = applyInterviewAnswer(project, turn, {
      sourceKind: 'manual',
      text: 'Support health\nHow support leaders prioritize accounts needing intervention.',
    });

    expect(result.addedSourceId).toBeUndefined();
    expect(result.project.domain.identity.name).toBe('Support health');
    expect(result.project.metadata.name).toBe('Support health');
    expect(result.project.domain.identity.description).toContain('prioritize accounts');
  });

  it('appends business pointers into the product summary', () => {
    const project = createBlankProject('Customer health', new Date('2026-07-22T10:00:00.000Z'));
    let progress = createInterviewProgress();
    for (const id of ['domain-identity', 'domain-owners', 'sources-primary']) {
      progress = markInterviewAnswered(progress, id);
    }
    const turn = nextInterviewTurn(progress);
    const result = applyInterviewAnswer(project, turn, {
      sourceKind: 'paste',
      text: 'Healthy account: no critical risk for two weeks.',
      sourceName: 'Glossary paste',
    });

    expect(result.shouldCollectStatic).toBe(true);
    expect(result.project.productContext.summary).toContain('Paste text');
    expect(result.project.productContext.summary).toContain('Healthy account');
  });
});
