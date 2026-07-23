import type { Metadata } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono, Source_Sans_3 } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';

const heading = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-heading',
});
const body = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-body',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Lineage Workbench · Context Layer',
  description: 'Author governed, evidence-linked context for agent systems.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${heading.variable} ${body.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
