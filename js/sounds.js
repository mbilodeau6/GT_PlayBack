/**
 * Sound effects using Web Audio API.
 * Generates simple synthesized sounds without external files.
 */

const Sounds = {
    audioContext: null,
    masterVolume: 0.5, // 0.0 to 1.0

    // Initialize audio context (must be called after user interaction)
    init() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        // Resume context if suspended (browsers require user interaction)
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    },

    // Set master volume (0.0 to 1.0)
    setVolume(level) {
        this.masterVolume = Math.max(0, Math.min(1, level));
        localStorage.setItem('catan_sound_volume', this.masterVolume.toString());
    },

    // Get current volume
    getVolume() {
        return this.masterVolume;
    },

    // Load saved volume from localStorage
    loadVolume() {
        const saved = localStorage.getItem('catan_sound_volume');
        if (saved !== null) {
            this.masterVolume = parseFloat(saved);
        }
    },

    // Play a simple tone
    playTone(frequency, duration, type = 'sine', volume = 0.3) {
        if (this.masterVolume === 0) return; // Skip if muted

        this.init();
        const ctx = this.audioContext;

        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

        // Apply master volume to the note's volume
        const adjustedVolume = volume * this.masterVolume;

        // Envelope: quick attack, sustain, then fade out
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(adjustedVolume, ctx.currentTime + 0.05);
        gainNode.gain.linearRampToValueAtTime(adjustedVolume * 0.7, ctx.currentTime + duration * 0.7);
        gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);

        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + duration);
    },

    // Play a sequence of tones
    playSequence(notes, tempo = 150) {
        const beatDuration = 60 / tempo;
        let time = 0;

        notes.forEach(note => {
            setTimeout(() => {
                this.playTone(note.freq, note.duration || beatDuration, note.type || 'sine', note.volume || 0.3);
            }, time * 1000);
            time += note.duration || beatDuration;
        });
    },

    // "Your turn" notification - pleasant ascending chime
    playYourTurn() {
        this.playSequence([
            { freq: 523, duration: 0.1 },  // C5
            { freq: 659, duration: 0.1 },  // E5
            { freq: 784, duration: 0.2 }   // G5
        ]);
    },

    // Victory fanfare - triumphant ascending melody
    playVictory() {
        this.playSequence([
            { freq: 523, duration: 0.15, volume: 0.4 },  // C5
            { freq: 523, duration: 0.15, volume: 0.4 },  // C5
            { freq: 523, duration: 0.15, volume: 0.4 },  // C5
            { freq: 523, duration: 0.3, volume: 0.4 },   // C5
            { freq: 415, duration: 0.3, volume: 0.4 },   // Ab4
            { freq: 466, duration: 0.3, volume: 0.4 },   // Bb4
            { freq: 523, duration: 0.15, volume: 0.4 },  // C5
            { freq: 466, duration: 0.1, volume: 0.4 },   // Bb4
            { freq: 523, duration: 0.5, volume: 0.4 }    // C5
        ]);
    },

    // Defeat sound - descending, minor tones
    playDefeat() {
        this.playSequence([
            { freq: 392, duration: 0.3, type: 'triangle', volume: 0.25 },  // G4
            { freq: 349, duration: 0.3, type: 'triangle', volume: 0.25 },  // F4
            { freq: 330, duration: 0.3, type: 'triangle', volume: 0.25 },  // E4
            { freq: 262, duration: 0.5, type: 'triangle', volume: 0.2 }    // C4
        ]);
    }
};
