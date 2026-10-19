# Ban/Pick System

A real-time team selection system inspired by Dota/LoL ban-pick phases.

## Features
- **Configurable Teams & Members**: Easily manage teams and candidate lists.
- **Drag & Drop Selection**: Intuitive interface for picking teammates.
- **Real-time Sync**: Multi-terminal synchronization using SWR polling.
- **Dota-style Timing**: Turn duration + team-specific reserve time.
- **Auto-Pick**: Automatically picks a random member when time expires.
- **Randomize**: Shuffle all members into teams instantly.

## Setup

### 1. Database
This project uses **Neon (Postgres)**. 
- Create a project on [Neon](https://neon.tech).
- Get your `DATABASE_URL`.

### 2. Environment Variables
Create a `.env` file in the root directory:
```env
DATABASE_URL="your_neon_postgres_connection_string"
```

### 3. Install & Initialize
```bash
npm install
npx prisma db push
```

### 4. Run Development
```bash
npm run dev
```

## Deployment on Vercel
1. Push this code to GitHub.
2. Connect your GitHub repo to [Vercel](https://vercel.com).
3. Add the `DATABASE_URL` environment variable in Vercel project settings.
4. Vercel will automatically detect the Next.js project and deploy it.
