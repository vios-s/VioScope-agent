import assert from 'node:assert/strict';
import { documentToText } from '../src/mastra/gitbook/extract';

const url = 'https://forms.example.edu/annual-leave';
const text = documentToText({
  type: 'document',
  nodes: [
    {
      type: 'paragraph',
      nodes: [
        { text: 'Complete the ' },
        {
          type: 'link',
          data: { ref: { kind: 'url', url } },
          nodes: [{ text: 'Annual Leave Request form' }],
        },
      ],
    },
  ],
});

assert.equal(text, `Complete the Annual Leave Request form (${url})`);
console.log('GitBook link extraction check passed.');
