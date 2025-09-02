# ThinkCraft Lite

A lean brainstorming graph application that uses NLP-powered phrase analysis to help you discover connections between ideas.

## Features

- **Phrase Ingestion**: Add phrases and automatically extract words, analyze POS patterns, and discover chunks
- **Related Phrase Discovery**: Find semantically related phrases based on shared lemmas and patterns
- **Prompt Generation**: Create prompts from phrases using customizable templates
- **Response Recording**: Record and rate responses to build your knowledge graph
- **Chunk Promotion**: Promote interesting chunks to standalone phrases
- **Persistent Storage**: Automatic saving to IndexedDB with localStorage fallback

## Tech Stack

- **React 18** + **TypeScript** + **Vite**
- **winkNLP** for natural language processing
- **IndexedDB** for persistent storage
- **Tailwind CSS** for styling
- **Vitest** for testing

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd thinkcraft-lite
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser to `http://localhost:3000`

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run test` - Run tests
- `npm run format` - Format code with Prettier
- `npm run lint` - Lint code with ESLint

## Usage

### 1. Ingest Phrases

Start by adding phrases to your graph:

1. Go to the **Ingest** tab
2. Enter a phrase or sentence (e.g., "The quick brown fox jumps over the lazy dog")
3. Click **Ingest Phrase**
4. View the extracted words, POS pattern, and chunks
5. Promote interesting chunks to standalone phrases

### 2. Explore Connections

Discover related ideas:

1. Go to the **Explore** tab
2. Select a phrase from your collection
3. View related phrases and top chunks
4. Select a template to create prompts
5. Click **Create Prompt** to generate a prompt

### 3. Generate Responses

Build your knowledge graph:

1. Go to the **Prompt** tab
2. Select a prompt from your collection
3. Enter your response
4. Rate your response (Like/Skip)
5. Promote good responses to phrases

## Data Model

The application uses a lean graph structure with four node types:

- **WORD**: Individual words with lemmas and POS tags
- **PHRASE**: Complete phrases with POS patterns and chunks
- **PROMPT**: Generated prompts with slot bindings
- **RESPONSE**: User responses linked to prompts

## Architecture

### Core Components

- **SemanticGraphLite**: In-memory graph with fast lookups
- **NLPAnalyzer**: Text analysis using winkNLP
- **IngestionPipeline**: Phrase processing and chunk extraction
- **RetrievalEngine**: Related phrase discovery
- **PromptEngine**: Template-based prompt generation
- **ResponseEngine**: Response recording and rating

### Key Features

- **Chunk Extraction**: POS-rule based chunking (NP, VP, PP patterns)
- **Similarity Scoring**: Lemma overlap + pattern matching + usage stats
- **Template System**: Flexible prompt templates with slot filling
- **Persistence**: Automatic saving with debounced writes
- **Responsive UI**: Clean, modern interface with Tailwind CSS

## Testing

Run the test suite:

```bash
npm run test
```

Tests cover:
- NLP analysis and chunk extraction
- Graph operations and serialization
- Ingestion pipeline
- Retrieval and similarity scoring

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

Requires IndexedDB support for persistence.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- [winkNLP](https://winkjs.org/wink-nlp/) for natural language processing
- [React](https://reactjs.org/) for the UI framework
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [Vite](https://vitejs.dev/) for the build tool
