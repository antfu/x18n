import { spawn } from 'node:child_process'

function writeMessage(stream, message) {
  const body = JSON.stringify(message)
  stream.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
}

function readChunk(stream) {
  return new Promise((resolve) => {
    if (stream.readableEnded) return resolve(null)
    const onReadable = () => {
      const chunk = stream.read()
      if (chunk) {
        cleanup()
        resolve(chunk)
      }
    }
    const onEnd = () => {
      cleanup()
      resolve(null)
    }
    const cleanup = () => {
      stream.off('readable', onReadable)
      stream.off('end', onEnd)
    }
    stream.on('readable', onReadable)
    stream.on('end', onEnd)
    onReadable()
  })
}

function createLspClient(child) {
  let buffer = Buffer.alloc(0)
  let nextId = 1
  child.stdout.resume()

  async function readMessage() {
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        const chunk = await readChunk(child.stdout)
        if (!chunk) throw new Error('stream closed before header')
        buffer = Buffer.concat([buffer, chunk])
        continue
      }

      const header = buffer.slice(0, headerEnd).toString('utf8')
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) throw new Error(`missing Content-Length in header: ${header}`)
      const length = Number.parseInt(match[1], 10)
      const start = headerEnd + 4
      while (buffer.length < start + length) {
        const chunk = await readChunk(child.stdout)
        if (!chunk) throw new Error('stream closed before body')
        buffer = Buffer.concat([buffer, chunk])
      }

      const body = buffer.slice(start, start + length).toString('utf8')
      buffer = buffer.slice(start + length)
      return JSON.parse(body)
    }
  }

  async function request(method, params) {
    const id = nextId++
    writeMessage(child.stdin, { jsonrpc: '2.0', id, method, params })
    while (true) {
      const message = await readMessage()
      if (message.id === id) {
        if (message.error) throw new Error(message.error.message)
        return message.result
      }
    }
  }

  function notify(method, params) {
    writeMessage(child.stdin, { jsonrpc: '2.0', method, params })
  }

  return { request, notify }
}

export async function withServer(bin, run) {
  const child = spawn(process.execPath, [bin, '--stdio'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  try {
    return await run(createLspClient(child))
  } finally {
    child.kill()
  }
}
