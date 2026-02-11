class SoundManager {
    constructor() {
        this.context = null;
        this.muted = false;
        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.context = new AudioContext();
        } catch(e) { console.error('Web Audio API not supported.'); }
    }

    // Must be called after user gesture (click)
    resume() {
        if (this.context && this.context.state === 'suspended') {
            this.context.resume();
        }
    }

    toggleMute() {
        this.muted = !this.muted;
        return this.muted;
    }

    playTone(freq, type, duration) {
        if (this.muted || !this.context) return;
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.context.currentTime);

        gain.gain.setValueAtTime(0.1, this.context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.context.destination);

        osc.start();
        osc.stop(this.context.currentTime + duration);
    }

    playClick() { this.playTone(400, 'sine', 0.1); }
    playCoin() { this.playTone(800, 'triangle', 0.15); setTimeout(() => this.playTone(1200, 'triangle', 0.3), 100); }
    playError() { this.playTone(150, 'sawtooth', 0.3); }
    playWin() {
        this.playTone(400, 'sine', 0.1);
        setTimeout(() => this.playTone(600, 'sine', 0.1), 150);
        setTimeout(() => this.playTone(800, 'sine', 0.4), 300);
    }
    playLose() {
        this.playTone(300, 'sawtooth', 0.2);
        setTimeout(() => this.playTone(200, 'sawtooth', 0.4), 200);
    }
}

window.audio = new SoundManager();
