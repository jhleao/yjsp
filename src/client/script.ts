import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const doc = new Y.Doc();

const provider = new WebsocketProvider('ws://localhost:1234', 'room', doc);

const ytext = doc.getText('root');

const textarea = document.getElementById('input') as HTMLTextAreaElement | null;

let lastCursorPosition = 0;
let lastValueLength = 0;

if (textarea) {
  textarea.onclick = () => {
    lastCursorPosition = textarea.selectionStart;
  };

  textarea.onkeydown = (event) => {
    lastCursorPosition = textarea.selectionStart;
  };

  textarea.oninput = () => {
    const newValue = textarea.value;
    const diff = newValue.length - lastValueLength;

    if (diff > 0) {
      const insertedText = newValue.substr(lastCursorPosition, diff);
      ytext.insert(lastCursorPosition, insertedText);
    } else if (diff < 0) {
      const from = lastCursorPosition + diff;
      const length = Math.abs(diff);
      ytext.delete(from, length);
    }

    lastCursorPosition = textarea.selectionStart;
  };

  doc.on('update', () => {
    textarea.value = ytext.toString();
    lastValueLength = textarea.value.length;
  });

  textarea.value = ytext.toString();
}

provider.awareness.on('update', ({ added, updated, removed }: any) => {
  console.log('Awareness updates:', added, updated, removed);
});
