import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { NativeInteractions } from '../src/host/native-interactions.ts'
import type { ClientResponse } from '../vendor/api-contract/api/index.js'

// A terminal observer (sink) that throws must not strand a foreground
// question: the approval path already guards its frame emits, and the
// question path must settle the same way.
it('throwing resolved-frame sink must not hang the question', async () => {
  const interactions = new NativeInteractions()
  interactions.subscribe(frame => {
    if (frame.payload.type === 'question/resolved') throw new Error('observer boom')
  })
  const agent = { id: SessionId('synthetic-observer-fault') }
  const answer = interactions.questions(
    { agent, questions: [{ id: 'q', question: '?', options: [{ label: 'A' }] }] },
    async () => ({ answers: [] }),
  )
  let settled = false
  void answer.then(() => { settled = true }, () => { settled = true })
  const replayed: { rpcId: string }[] = []
  interactions.replay(agent.id, frame => { replayed.push(frame as { rpcId: string }) })
  const response = {
    type: 'client-response',
    rpcId: replayed[0]!.rpcId,
    result: { ok: true, value: { sessionId: agent.id, answer: { answers: [{ id: 'q', selected: ['A'] }] } } },
  } as unknown as ClientResponse
  expect(interactions.respond(response)).toEqual({ accepted: true })
  await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] })
  expect(settled).toBe(true)
})

it('throwing requested-frame sink rejects cleanly and retains no pending wait', async () => {
  const interactions = new NativeInteractions()
  interactions.subscribe(frame => {
    if (frame.payload.type === 'question/requested') throw new Error('observer boom')
  })
  const agent = { id: SessionId('synthetic-observer-fault-2') }
  const answer = interactions.questions(
    { agent, questions: [{ id: 'q', question: '?' }] },
    async () => ({ answers: [] }),
  )
  await expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
  const replayed: unknown[] = []
  interactions.replay(agent.id, frame => { replayed.push(frame) })
  expect(replayed).toEqual([])
})
