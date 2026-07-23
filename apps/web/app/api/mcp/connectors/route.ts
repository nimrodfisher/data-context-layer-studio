import { NextResponse } from 'next/server';

import { discoverMcpConnectors } from '../../../../lib/mcp-discovery';
import { publicError } from '../../../../lib/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const result = await discoverMcpConnectors();
    return NextResponse.json({
      connectors: result.connectors,
      catalogToolCounts: result.catalogToolCounts,
    });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}
