// node --test test/  (no Orca needed)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createArgs, createError, recommendedSize, sizeMark, vmNameError } from '../shared/vm-options.mjs'
import { copyCommands, diskGb, overview } from '../worker/shako.mjs'

test('size marks as in the web rail: S M L XL, and C for a custom size', () => {
  assert.equal(sizeMark('1cpu/2G'), 'S')
  assert.equal(sizeMark('2cpu/4G'), 'M')
  assert.equal(sizeMark('4cpu/8G'), 'L')
  assert.equal(sizeMark('4cpu/16G'), 'XL')
  assert.equal(sizeMark('4cpu/12G'), 'C')
  assert.equal(sizeMark('1cpu/2048M'), 'S')
})

test('recommended size, as the web New VM form', () => {
  assert.equal(recommendedSize([], false), null)
  assert.equal(recommendedSize(['claude'], false), 'small')
  assert.equal(recommendedSize(['claude', 'hermes'], false), 'mid')
  assert.equal(recommendedSize(['claude'], true), 'mid')
})

test('VM names and choices the box accepts', () => {
  assert.equal(vmNameError('web1'), null)
  assert.equal(vmNameError('my-app-2'), null)
  for (const bad of ['', '1web', 'Web1', 'a--b', 'a-', 'a_b', 'x'.repeat(32)]) assert.ok(vmNameError(bad), bad)
  assert.equal(createError({ name: 'web1', size: 'small', agents: [], desktop: false }), null)
  assert.match(createError({ name: 'web1', size: 'small', agents: [], desktop: true }), /need an agent/)
  assert.match(createError({ name: 'web1', size: 'small', agents: ['claude'], desktop: true }), /Mid or bigger/)
  assert.match(createError({ name: 'web1', size: 'huge', agents: [], desktop: false }), /size/)
  assert.match(createError({ name: 'web1', size: 'small', agents: ['nope'], desktop: false }), /Unknown agent/)
})

test('the create command line', () => {
  assert.deepEqual(createArgs({ name: 'web1', size: 'small', agents: [], desktop: false }),
    ['vm', 'create', 'web1', '--size', 'small', '--no-wait'])
  assert.deepEqual(createArgs({ name: 'web1', size: 'mid', agents: ['claude', 'codex'], desktop: true }),
    ['vm', 'create', 'web1', '--size', 'mid', '--agent', 'claude,codex', '--desktop', '--no-wait'])
  assert.throws(() => createArgs({ name: 'Bad', size: 'small', agents: [], desktop: false }))
  assert.throws(() => createArgs({ name: 'web1; rm -rf /', size: 'small', agents: [], desktop: false }))
})

test('overview totals and copy commands', () => {
  const vms = [
    { state: 'awake', size: '1cpu/2G', disk: '20G' },
    { state: 'asleep', size: '4cpu/12G', disk: '96G' },
    { state: 'creating', size: '2cpu/4G', disk: '32G' }
  ]
  assert.deepEqual(overview(vms), { total: 3, awake: 1, asleep: 1, other: 1, ramGb: 18, diskGb: 148 })
  assert.equal(diskGb('80G'), 80)
  assert.deepEqual(copyCommands('darwin'), [['pbcopy', []]])
  assert.equal(copyCommands('linux')[0][0], 'wl-copy')
  assert.deepEqual(copyCommands('win32'), [])
})
