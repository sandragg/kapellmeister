import { now, timer, timeout } from 'd3-timer'
import getTween from './getTween'
import {
  once,
  timingDefaults,
  extend,
  getTransitionId,
} from './utils'
import {
  Transition
} from './types'

const CREATED = 0
const QUEUED = 1
const STARTING = 2
const STARTED = 3
const RUNNING = 4
const STOPPING = 5
const STOPPED = 6

class Node {
  state: object
  private __TRANSITIONS__: object

  constructor(state?: object) {
    this.state = state || {} 
  }

  animate(config: Array<object> | object) {
    if (Array.isArray(config)) {
      for (let i = 0; i < config.length; i++) {
        this.parse(config[i])
      }
    } else {
      this.parse(config)
    }
  }

  isAnimating() {
    return !!this.__TRANSITIONS__
  }

  setState(update: object) {
    if (typeof update === 'function') {
      extend(this.state, update(this.state))
    } else {
      extend(this.state, update)
    }
  }

  private parse(config): void {
    const transitions = { ...config }
  
    const events = transitions.events || {}
  
    if (transitions.events) {
      delete transitions.events
    }
  
    const timing = { ...timingDefaults, ...transitions.timing || {}, time: now() }
  
    if (transitions.timing) {
      delete transitions.timing
    }
  
    Object.keys(events).forEach(d => {
      if (typeof events[d] !== 'function') {
        throw new Error('Event handlers must be a function')
      } else {
        events[d] = once(events[d])
      }
    })
  
    Object.keys(transitions).forEach((stateKey) => {
      const tweens = []
  
      if (Array.isArray(transitions[stateKey])) {
        const val = transitions[stateKey]
  
        if (Array.isArray(val)) {
          if (val.length === 1) {
            tweens.push(getTween.call(this, null, stateKey, val[0]))
          } else {
            this.setState({ [stateKey]: val[0] })
            tweens.push(getTween.call(this, null, stateKey, val[1]))
          }
        } else if (typeof val === 'function') {
          const getCustomTween = () => {
            const kapellmeisterTween = (t: number) => {
              this.setState({ [stateKey]: val(t) })
            }
  
            return kapellmeisterTween
          }
  
          tweens.push(getCustomTween)
        } else {
          this.setState({ [stateKey]: val })
          tweens.push(getTween.call(this, null, stateKey, val))
        }
      } else {
        Object.keys(transitions[stateKey]).forEach((attr) => {
          const val = transitions[stateKey][attr]
  
          if (Array.isArray(val)) {
            if (val.length === 1) {
              tweens.push(getTween.call(this, stateKey, attr, val[0]))
            } else {
              this.setState((state: object) => {
                return { [stateKey]: { ...state[stateKey], [attr]: val[0] } }
              })
  
              tweens.push(getTween.call(this, stateKey, attr, val[1]))
            }
          } else if (typeof val === 'function') {
            const getNameSpacedCustomTween = () => {
              const kapellmeisterNamespacedTween = (t: number) => {
                this.setState((state: object) => {
                  return { [stateKey]: { ...state[stateKey], [attr]: val(t) } }
                })
              }
  
              return kapellmeisterNamespacedTween
            }
  
            tweens.push(getNameSpacedCustomTween)
          } else {
            this.setState((state: object) => {
              return { [stateKey]: { ...state[stateKey], [attr]: val } }
            })
  
            tweens.push(getTween.call(this, stateKey, attr, val))
          }
        })
      }
  
      this.update({ stateKey, timing, tweens, events, status: CREATED })
    })
  }

  private update(config: Transition) {
    const transitions = this.__TRANSITIONS__
    
    if (!transitions) {
      this.__TRANSITIONS__ = {}
    }
  
    this.init(getTransitionId(), config)
  }
  
  private init(id: number, transition: Transition) {
    const transitions: Object = this.__TRANSITIONS__
  
    const n = transition.tweens.length
    const tweens = new Array(n)
  
    
    const queue = (elapsed: number) => {
      transition.status = QUEUED
      transition.timer.restart(start, transition.timing.delay, transition.timing.time)
      
      if (transition.timing.delay <= elapsed) {
        start(elapsed - transition.timing.delay)
      }
    }

    transitions[id] = transition
    transition.timer = timer(queue, 0, transition.timing.time)
    
    const start = (elapsed: number) => {
      if (transition.status !== QUEUED) return stop()
  
      for (const tid in transitions) {
        const t: Transition = transitions[tid]
  
        if (t.stateKey !== transition.stateKey) {
          continue
        }
  
        if (t.status === STARTED) {
          return timeout(start)
        }
  
        if (t.status === RUNNING) {
          t.status = STOPPED
          t.timer.stop()
  
          if (t.events.interrupt) {
            t.events.interrupt.call(this)
          }
          
          delete transitions[tid]
        } else if (+tid < id) {
          t.status = STOPPED
          t.timer.stop()
          
          delete transitions[tid]
        }
      }
  
      timeout(() => {
        if (transition.status === STARTED) {
          transition.status = RUNNING
          transition.timer.restart(tick, transition.timing.delay, transition.timing.time)
          tick(elapsed)
        }
      })
  
      transition.status = STARTING
      
      if (transition.events.start && typeof transition.events.start === 'function') {
        transition.events.start.call(this)
      }
  
      if (transition.status !== STARTING) {
        return
      }
  
      transition.status = STARTED
  
      let j = -1
  
      for (let i = 0; i < n; ++i) {
        const res = transition.tweens[i].call(this)
  
        if (res) {
          tweens[++j] = res
        }
      }
  
      tweens.length = j + 1
    }
  
    const tick = (elapsed: number) => {
      let t = 1
  
      if (elapsed < transition.timing.duration) {
        t = transition.timing.ease.call(null, elapsed / transition.timing.duration)
      } else {
        transition.timer.restart(stop)
        transition.status = STOPPING
      }
  
      let i = -1
  
      while (++i < tweens.length) {
        tweens[i].call(null, t)
      }
  
      if (transition.status === STOPPING) {
        if (transition.events.end) {
          transition.events.end.call(this)
        }
  
        stop()
      }
    }
  
    const stop = () => {
      transition.status = STOPPED
      transition.timer.stop()
  
      delete transitions[id]
      for (const i in transitions) return
      delete this.__TRANSITIONS__
    }
  }

  stopAnimating() {
    const transitions = this.__TRANSITIONS__
  
    if (transitions) {
      Object.keys(transitions).forEach((t) => {
        transitions[t].timer.stop()
      })
    }
  }

}

export default Node