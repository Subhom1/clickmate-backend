# Clickmate Backend Application

Clickmate Backend is a server-side application designed to power the Clickmate mobile social network. Built using Express and Node.js, the backend coordinates user profile registration, secure authentication synchronization with Firebase, semantic matchmaking via neural text similarity models, real-time message exchange, and exploration feed aggregation.

## System Architecture and Technologies

The application leverages a modern, async-driven JavaScript stack alongside Python-based natural language processing:

- Express and Node.js: Serve as the underlying application framework handling RESTful HTTP routes.
- Socket.io: Enables bidirectional, event-driven communication for live chat messaging and immediate matchmaking updates.
- MongoDB and Mongoose: Provide data persistence. Object schemas define user configurations, chats, active queries, interest tags, and categorized explore cards.
- Firebase Admin SDK: Integrates with Firebase authentication services to verify identity and clean up records when accounts are deleted.
- Python Sentence Transformers: Runs a background similarity process comparing user search intentions using the paraphrase-mpnet-base-v2 model.
- OpenAI API: Included as an alternative embedding methodology using the text-embedding-ada-002 model to compute vector cosine similarity.
- Multer: Facilitates disk storage and validation for user-uploaded image attachments.

## Data Models

The system architecture relies on several structured MongoDB schemas:

- User: Stores credentials, profiles, biographical information, referencing collections of interests and lists of user friends.
- Chat: Maintains participant records and an ordered list of individual messages containing content, timestamps, and read receipts.
- User Search: Holds transient search entries submitted by active clients, featuring locks to prevent duplicate matching.
- Match List: Documents success scores and similarity indexes between paired users.
- Interest: Lists pre-validated hobby and category labels available for user profiles.
- Explore: Maps categories to groups of elements containing descriptive text and matching image resource links.

## Core Features and Workflows

### User Operations
Endpoints allow client applications to register new accounts, retrieve populated profiles, modify specific metadata like bios or interests, and clean up MongoDB collections and Firebase authorization credentials concurrently.

### Semantic Matchmaking
Matchmaking is triggered when a user submits a keyword search through WebSockets. The server registers the interest query and runs a similarity algorithm comparing it to other active searchers in the database:
- The system queries a persistent local FastAPI similarity microservice running on port 8001 that pre-loads the Sentence Transformer model (`paraphrase-mpnet-base-v2`) on startup.
- If two users' queries share a blended score above the threshold, they are locked atomically using a deterministic sorted-pair locking protocol to prevent concurrent match races.
- The server emits matching confirmations to both clients via Socket.io, removes the queries from the active pool, and sets up a new chat thread.
- Blended scores are calculated using a weighted combination of query semantic similarity (default 70%) and user interest Jaccard overlap (default 30%). If a user has no interests registered, the algorithm automatically falls back to 100% query similarity.
- If no match is found within 30 seconds, the search times out. Users can also cancel their searches manually.

### Real-Time Chat
Once a match is accepted, the server establishes a new chat record:
- Clients connect to chat rooms via WebSocket events.
- Messages are saved to MongoDB, and received events are broadcast immediately to room members.
- The system keeps track of read receipts and aggregates unread message counts per user across all chat threads.

### Explore and Uploads
Administrators and users can populate feed categories. The application validates media dimensions and formats using Multer, storing approved items locally within public upload folders and serving them statically.

## Setup and Installation

### Prerequisites
- Node.js version 21.4.0 or compatible.
- Python 3 with the sentence-transformers and FastAPI libraries installed.
- Access to a MongoDB database (such as MongoDB Atlas).
- Firebase Admin Service Account JSON configuration.
- OpenAI API credentials (optional).

### Node Dependencies
To install the required packages, run the following command in the project root:
```bash
npm install
```

### Python Setup
For the matchmaking feature, ensure Python is installed along with sentence-transformers, FastAPI, and Uvicorn:
```bash
pip install sentence-transformers torch fastapi uvicorn
```

### Configuration Files
Three key files must be configured in the project root:

1. Environment File: Create a `.env` file containing:
   ```env
   PORT=5051
   SIMILARITY_THRESHOLD=0.5
   SIMILARITY_SERVICE_URL=http://127.0.0.1:8001/similarity
   QUERY_WEIGHT=0.7
   INTEREST_WEIGHT=0.3
   OPENAI_API_KEY=your_openai_api_key_here
   ```

2. Database Configuration: Modify Secret.js to export your MongoDB connection URI:
   ```javascript
   export const uri = "your_mongodb_connection_uri_here";
   ```

3. Firebase Authorization: Place your Firebase Admin SDK credential file in the root directory. The file name must match the one imported in FirebaseAdmin.js:
   ```text
   clickmate-57ede-firebase-adminsdk-7qhtz-41c63795e9.json
   ```

## Running the Application

To run the full backend matchmaking system, you need to start both services:

### 1. Start the Similarity Microservice
Start the Python FastAPI service:
```bash
python3 scripts/similarity_service.py
```
This runs the persistent server on `http://127.0.0.1:8001`.

### 2. Start the Node.js Server
Start the development server using nodemon:
```bash
npm start
```
This runs the primary WebSocket and API server on `http://localhost:5051`.

## API Reference

### HTTP API Endpoints

- POST `/register`: Creates a new user record.
- GET `/user/:email`: Returns detailed user records by email, including populated relationships.
- GET `/users/:userId/friends`: Retrieves the friend listing for the requested user.
- PATCH `/user/:userId`: Updates select profile fields.
- DELETE `/deleteUser/:uid/`: Deletes user profiles in MongoDB and Firebase Auth.
- GET `/interests`: Fetches all predefined system interests.
- POST `/create-chat`: Initiates a conversation thread between two users.
- GET `/chat/:user1Id/:user2Id`: Retrieves existing chat history.
- GET `/unread-messages/:userId`: Returns counts of unread messages.
- POST `/add-items/:categoryId`: Appends uploaded elements and images to explore categories.
- POST `/add-explore-category`: Adds a new exploration category header.
- GET `/explore`: Retrieves all exploration categories and lists.

### Socket.io Events

#### Client to Server
- `submit_keyword`: Registers a search query and launches the matchmaking worker.
- `cancel_search`: Aborts active matchmaking requests.
- `joinChat`: Adds the socket channel to a specific conversation room.
- `leaveChat`: Removes the socket channel from a conversation room.
- `sendMessage`: Forwards new messages to the database and participant rooms.
- `markAsRead`: Flags messages as read by the user.
- `clearMessages`: Resets the message array within a conversation.

#### Server to Client
- `search_update`: Sends matching profile data or cancel status notifications.
- `receiveMessage`: Delivers new incoming messages to room participants.
- `updateUnreadCounts`: Signals clients to fetch updated unread message tallies.
- `messagesCleared`: Confirms that conversation histories have been reset.
- `error`: Transmits general exception messages.
