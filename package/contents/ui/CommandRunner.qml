import QtQuick
import org.kde.plasma.plasma5support as P5Support

P5Support.DataSource {
    id: runner

    readonly property int defaultTimeoutMs: 30000
    property var jobs: ({})
    property int runningCount: 0

    function settleWaiter(waiter, result) {
        if (waiter.done) {
            return
        }
        waiter.done = true
        waiter.timer.stop()
        waiter.timer.destroy()
        waiter.resolve(result)
    }

    function finish(command, result) {
        const job = jobs[command]
        if (!job) {
            return
        }
        delete jobs[command]
        runningCount -= 1
        disconnectSource(command)
        job.waiters.forEach(waiter => settleWaiter(waiter, result))
    }

    function run(command, timeoutMs) {
        return new Promise(resolve => {
            const waiter = { resolve: resolve, done: false, timer: timeoutTimer.createObject(runner, { interval: timeoutMs || defaultTimeoutMs }) }
            waiter.timer.triggered.connect(() => runner.settleWaiter(waiter, { exitCode: -1, stdout: "", stderr: "", timedOut: true }))
            if (jobs[command]) {
                jobs[command].waiters.push(waiter)
            } else {
                jobs[command] = { waiters: [waiter] }
                runningCount += 1
                connectSource(command)
            }
            waiter.timer.start()
        })
    }

    engine: "executable"
    connectedSources: []

    onNewData: (sourceName, data) => {
        finish(sourceName, { exitCode: data["exit code"], stdout: data["stdout"], stderr: data["stderr"], timedOut: false })
    }

    property Component timeoutTimer: Component {
        Timer {
            repeat: false
        }
    }
}
