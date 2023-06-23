import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import { WebsocketProvider } from 'y-websocket';

const doc = new Y.Doc();
const provider = new WebsocketProvider('ws://localhost:1234', 'room', doc);

const editor = new Editor({
  element: document.querySelector('#tiptap-container') as Element,
  extensions: [
    StarterKit.configure({
      // The Collaboration extension comes with its own history handling
      history: false,
    }),
    // Register the document with Tiptap
    Collaboration.configure({
      document: doc,
    }),
  ],
});
