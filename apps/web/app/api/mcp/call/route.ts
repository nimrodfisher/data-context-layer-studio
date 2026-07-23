import { redactSecrets } from '@context-layer/core';
import { NextResponse } from 'next/server';

import { discoverMcpConnectors, isReadOnlyToolName, matchConnectorByHint } from '../../../../lib/mcp-discovery';
import { callConnectorTool } from '../../../../lib/mcp-runtime';
import { LimitedRequestError, readLimitedJson } from '../../../../lib/request';
import { publicError } from '../../../../lib/server';

export const runtime = 'nodejs';

const MAX_BYTES = 256 * 1024;

export async function POST(request: Request) {
  try {
    const body = (await readLimitedJson(request, MAX_BYTES)) as {
      connectorId?: unknown;
      toolName?: unknown;
      arguments?: unknown;
    };
    if (typeof body.connectorId !== 'string' || !body.connectorId.trim()) {
      return NextResponse.json({ error: 'connectorId is required.' }, { status: 400 });
    }
    if (typeof body.toolName !== 'string' || !body.toolName.trim()) {
      return NextResponse.json({ error: 'toolName is required.' }, { status: 400 });
    }
    if (!isReadOnlyToolName(body.toolName)) {
      return NextResponse.json(
        {
          error:
            'Only read-only tools (list_/get_/search_/read_/describe_/show_) are allowed from this API.',
        },
        { status: 403 },
      );
    }

    const discovered = await discoverMcpConnectors();
    const connector = matchConnectorByHint(discovered.connectors, body.connectorId);
    if (!connector) {
      return NextResponse.json({ error: 'Connector not found.' }, { status: 404 });
    }
    if (connector.status === 'configured-stdio' || connector.status === 'available-in-cursor') {
      return NextResponse.json(
        {
          error:
            'This connector is discoverable but not live-callable from the workbench MVP (stdio / catalog-only).',
          connectorId: connector.id,
          status: connector.status,
        },
        { status: 409 },
      );
    }

    const args =
      body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)
        ? (redactSecrets(body.arguments) as Record<string, unknown>)
        : {};

    const result = await callConnectorTool(connector.id, body.toolName.trim(), args);
    return NextResponse.json({
      connectorId: connector.id,
      toolName: body.toolName.trim(),
      ok: result.ok,
      text: result.text,
      isError: result.isError === true,
      diagnostics: result.diagnostics,
      hasAuth: connector.hasAuth,
    });
  } catch (error) {
    if (error instanceof LimitedRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}
