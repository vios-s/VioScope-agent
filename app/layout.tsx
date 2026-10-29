import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from 'next/font/google';
import type { ReactNode } from 'react';
import './tokens.css';
import './globals.css';
import './redesign.css';

const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-sans' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' });
const newsreader = Newsreader({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-newsreader' });

export const metadata: Metadata = {
  title: 'VioScope',
  description: 'VIOS lab operations console',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-GB"className={`${plexSans.variable} ${plexMono.variable} ${newsreader.variable}`}>
      <body>{children}</body>
    </html>
  );
}
