import { createServer } from 'http'
import { Server } from 'socket.io'
import { logger } from '@lexis/logger'

const log = logger('realtime')

const httpServer = createServer()
const io = new Server(httpServer, {
  cors: {
    origin: process.env.RT_CORS_ORIGIN || 'http://localhost:3001',
    credentials: true,
  },
})

io.on('connection', (socket) => {
  log.info({ socketId: socket.id }, 'Client connected')

  socket.on('disconnect', () => {
    log.info({ socketId: socket.id }, 'Client disconnected')
  })
})

const port = Number(process.env.RT_PORT) || 4000

httpServer.listen(port, () => {
  log.info({ port }, 'Lexis realtime server started')
})

process.on('SIGTERM', async () => {
  log.info('SIGTERM received, shutting down gracefully')
  io.close()
  await new Promise((r) => setTimeout(r, 25000))
  process.exit(0)
})
