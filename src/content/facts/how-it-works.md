---
question: How does this assistant work?
asks: [chatbot, bot, AI assistant, where does my question go, privacy, is my question stored, storing my questions, which model answers]
url: /ask/#how-it-works
---
This assistant helps you explore Daniil’s work, discuss a potential role, and find his CV, videos, demos, code and papers. Facts about Daniil come from the public portfolio and link their sources. General explanations and comparisons are distinguished from documented personal facts.

- **Portfolio search.** Search and concise replies run in your browser. You can retrieve the CV and project resources even when AI conversation is offline. Questions in this mode are not sent to an AI service.
- **AI conversation.** When connected, the question and up to six earlier AI conversation turns are sent through the site’s Cloudflare Worker to OpenAI. The model receives the public portfolio as reference material. It can explain projects, compare skills with a role, and answer follow-ups. It does not confirm Daniil’s availability or speak on his behalf. Private questions with fixed replies are handled locally. An installation configured for Anthropic uses that provider instead.
- **Conversation history.** The transcript is kept in this browser tab’s session storage to survive page changes. New chat clears it. The application does not keep a server-side conversation database or log message text; API providers process requests under their own data policies.
- **Files and links.** Resource cards use the website’s published files and project links. Videos can play in the dialog; PDFs can open or download. This does not send email or upload visitor files.
- **Voice input.** The microphone uses Cactus Whistle to transcribe up to 30 seconds on your device. Its 18 MB model and runtime download from this website on first use and are cached by your browser. Audio stays in browser memory and is discarded after transcription or cancellation. Closing the chat or switching tabs stops recording. Review the editable transcript before sending it; the selected answer mode determines where that text goes. Whistle detects English, German, French, Spanish, Italian, Dutch and Polish.
- **Smarter search.** An optional download of a small language model from huggingface.co and of its runtime from cdn.jsdelivr.net. The model then runs on your device, and your questions stay there.

Writing answers with a model on your own device is not available yet.
