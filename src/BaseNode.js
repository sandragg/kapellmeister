import { now, timer, timeout } from 'd3-timer'
import { timingDefaults, extend, getTransitionId, isNamespace } from './utils'
import Events from './Events'

class BaseNode {
  constructor(state) {
    this.state = state || {}
  }

  transition(config) {
    if (Array.isArray(config)) {
      for (const item of config) {
        this.parse(item)
      }
    } else {
      this.parse(config)
    }
  }

  isTransitioning() {
    return !!this.transitionData
  }

  stopTransitions() {
    const transitions = this.transitionData

    if (transitions) {
      Object.keys(transitions).forEach(t => {
        transitions[t].timer.stop()
      })
    }
  }

  setState(update) {
    if (typeof update === 'function') {
      extend(this.state, update(this.state))
    } else {
      extend(this.state, update)
    }
  }


  parse(config) {
    const clone = { ...config }

    const events = new Events(clone)

    if (clone.events) {
      delete clone.events
    }

    const timing = {
      ...timingDefaults,
      ...(clone.timing || {}),
      time: now(),
    }

    if (clone.timing) {
      delete clone.timing
    }

    Object.keys(clone).forEach(stateKey => {
      const tweens = []
      const next = clone[stateKey]

      if (isNamespace(next)) {
        Object.keys(next).forEach(attr => {
          const val = next[attr]

          if (Array.isArray(val)) {
            if (val.length === 1) {
              tweens.push(this.getTween(attr, val[0], stateKey))
            } else {
              this.setState((state) => {
                return { [stateKey]: { ...state[stateKey], [attr]: val[0] } }
              })

              tweens.push(this.getTween(attr, val[1], stateKey))
            }
          } else if (typeof val === 'function') {
            const getNameSpacedCustomTween = () => {
              const kapellmeisterNamespacedTween = t => {
                this.setState(state => {
                  return { [stateKey]: { ...state[stateKey], [attr]: val(t) } }
                })
              }

              return kapellmeisterNamespacedTween
            }

            tweens.push(getNameSpacedCustomTween)
          } else {
            this.setState(state => {
              return { [stateKey]: { ...state[stateKey], [attr]: val } }
            })

            tweens.push(this.getTween(attr, val, stateKey))
          }
        })
      } else {
        if (Array.isArray(next)) {
          if (next.length === 1) {
            tweens.push(this.getTween(stateKey, next[0], null))
          } else {
            this.setState({ [stateKey]: next[0] })
            tweens.push(this.getTween(stateKey, next[1], null))
          }
        } else if (typeof next === 'function') {
          const getCustomTween = () => {
            const kapellmeisterTween = t => {
              this.setState({ [stateKey]: next(t) })
            }

            return kapellmeisterTween
          }

          tweens.push(getCustomTween)
        } else {
          this.setState({ [stateKey]: next })
          tweens.push(this.getTween(stateKey, next, null))
        }
      }

      this.update({ stateKey, timing, tweens, events, status: 0 })
    })
  }

  getTween(attr, endValue, nameSpace) {
    return () => {
      const begValue = nameSpace
        ? this.state[nameSpace][attr]
        : this.state[attr]

      if (begValue === endValue) {
        return null
      }

      const i = this.getInterpolator(begValue, endValue, attr, nameSpace)

      let stateTween

      if (nameSpace === null) {
        stateTween = t => {
          this.setState({ [attr]: i(t) })
        }
      } else {
        stateTween = t => {
          this.setState(state => {
            return { [nameSpace]: { ...state[nameSpace], [attr]: i(t) } }
          })
        }
      }

      return stateTween
    }
  }

  update(transition) {
    if (!this.transitionData) {
      this.transitionData = {}
    }

    this.init(getTransitionId(), transition)
  }

  init(id, transition) {
    const n = transition.tweens.length
    const tweens = new Array(n)

    const queue = elapsed => {
      transition.status = 1
      transition.timer.restart(
        start,
        transition.timing.delay,
        transition.timing.time,
      )

      if (transition.timing.delay <= elapsed) {
        start(elapsed - transition.timing.delay)
      }
    }

    this.transitionData[id] = transition
    transition.timer = timer(queue, 0, transition.timing.time)

    const start = elapsed => {
      if (transition.status !== 1) return stop()

      for (const tid in this.transitionData) {
        const t = this.transitionData[tid]

        if (t.stateKey !== transition.stateKey) {
          continue
        }

        if (t.status === 3) {
          return timeout(start)
        }

        if (t.status === 4) {
          t.status = 6
          t.timer.stop()

          if (t.events.interrupt) {
            t.events.interrupt.call(this)
          }

          delete this.transitionData[tid]
        } else if (+tid < id) {
          t.status = 6
          t.timer.stop()

          delete this.transitionData[tid]
        }
      }

      timeout(() => {
        if (transition.status === 3) {
          transition.status = 4
          transition.timer.restart(
            tick,
            transition.timing.delay,
            transition.timing.time,
          )
          tick(elapsed)
        }
      })

      transition.status = 2

      if (transition.events.start) {
        transition.events.start.call(this)
      }

      if (transition.status !== 2) {
        return
      }

      transition.status = 3

      let j = -1

      for (let i = 0; i < n; ++i) {
        const res = transition.tweens[i]()

        if (res) {
          tweens[++j] = res
        }
      }

      tweens.length = j + 1
    }

    const tick = elapsed => {
      let t = 1

      if (elapsed < transition.timing.duration) {
        t = transition.timing.ease(elapsed / transition.timing.duration)
      } else {
        transition.timer.restart(stop)
        transition.status = 5
      }

      let i = -1

      while (++i < tweens.length) {
        tweens[i](t)
      }

      if (transition.status === 5) {
        if (transition.events.end) {
          transition.events.end.call(this)
        }

        stop()
      }
    }

    const stop = () => {
      transition.status = 6
      transition.timer.stop()

      delete this.transitionData[id]
      for (const _ in this.transitionData) return
      delete this.transitionData
    }
  }
}

export default BaseNode
