import { NextResponse } from 'next/server';

import { discoverMcpConnectors, matchConnectorByHint } from '../../../../lib/mcp-discovery';
import { listConnectorTools } from '../../../../lib/mcp-runtime';
import { LimitedRequestError, readLimitedJson } from '../../../../lib/request';
import { publicError } from '../../../../lib/server';

export const runtime = 'nodejs';

const MAX_BYTES = 64 * 1024;

export async function POST(request: Request) {
  try {
    const body = (await readLimitedJson(request, MAX_BYTES)) as {
      connectorId?: unknown;
      preferCatalog?: unknown;
    };
    if (typeof body.connectorId !== 'string' || !body.connectorId.trim()) {
      return NextResponse.json({ error: 'connectorId is required.' }, { status: 400 });
    }

    const discovered = await discoverMcpConnectors();
    const connector = matchConnectorByHint(discovered.connectors, body.connectorId);
    if (!connector) {
      return NextResponse.json({ error: 'Connector not found.' }, { status: 404 });
    }

    const preferCatalog =
      body.preferCatalog === true ||
      connector.status === 'configured-stdio' ||
      connector.status === 'available-in-cursor';

    const listed = await listConnectorTools(connector.id, {
      preferCatalog,
      catalogToolNames: connector.toolNames,
    });

    return NextResponse.json({
      connectorId: connector.id,
      tools: listed.tools,
      source: listed.source,
      diagnostics: listed.diagnostics,
      hasAuth: connector.hasAuth,
      status: connector.status,
    });
  } catch (error) {
    if (error instanceof LimitedRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}
