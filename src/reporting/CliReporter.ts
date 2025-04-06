import chalk from "chalk";
import cliProgress from "cli-progress";
import { Spinner } from "@topcli/spinner";
// Removed NODE_ENV check

// Define interface for progress bar payload
interface ProgressBarPayload {
  format: string;
  stats: {
    errorCount: number;
    // Add other stats properties here if needed later
  };
}

export class CliReporter {
  // Store bar instance and its payload together
  private bars = new Map<
    string,
    { bar: cliProgress.Bar; payload: ProgressBarPayload }
  >();
  private multibar: cliProgress.MultiBar | null = null;
  // Removed the duplicate/old bars map definition below
  private spinner: Spinner | null = null;
  private verbose: boolean;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  // --- Spinner Methods ---

  startSpinner(text: string): void {
    // Starting a new spinner implicitly stops/replaces the old one visually
    this.spinner = new Spinner().start(text);
  }

  updateSpinnerText(text: string): void {
    if (!this.spinner) return; // Restore original check
    if (this.spinner) {
      // Keep original check for safety, though covered by above
      this.spinner.text = text;
    }
  }

  stopSpinnerSuccess(text?: string): void {
    if (!this.spinner) return; // Restore original check
    if (this.spinner) {
      // Keep original check
      this.spinner.succeed(text); // succeed() method should exist
      this.spinner = null;
    }
  }

  stopSpinnerFailure(text?: string): void {
    if (!this.spinner) return; // Restore original check
    if (this.spinner) {
      // Keep original check
      // Fallback to succeed() with a failure indicator as stop/fail/error don't seem to exist
      this.spinner.succeed(text ? `❌ ${text}` : "❌");
      this.spinner = null;
    }
  }

  // --- Progress Bar Methods ---

  initializeMultiBar(formats: string[], totals: Map<string, number>): void {
    this.multibar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        stopOnComplete: true,
        hideCursor: true,
        etaBuffer: 1000,
        barsize: 15,
        etaAsynchronousUpdate: true,
        format: this.formatProgressBar.bind(this), // Bind 'this' context
      },
      cliProgress.Presets.shades_classic
    );

    this.bars.clear(); // Clear previous bars if any
    for (const format of formats) {
      const total = totals.get(format) ?? 0;
      // Create initial payload
      const initialPayload: ProgressBarPayload = {
        format,
        stats: { errorCount: 0 /* other initial stats */ },
      };
      const bar = this.multibar.create(total, 0, initialPayload);
      // Store bar and its payload in the map
      this.bars.set(format, { bar, payload: initialPayload });
    }
  }

  updateProgress(
    format: string,
    increment: number,
    statsUpdate?: Partial<ProgressBarPayload["stats"]>
  ): void {
    // Allow partial stats update
    const barData = this.bars.get(format); // Get the object containing bar and payload
    if (barData) {
      // Retrieve current payload, update stats, store back, and pass to increment
      const currentPayload = barData.payload; // Get payload from barData
      const newStats = { ...currentPayload.stats, ...statsUpdate };
      const newPayload: ProgressBarPayload = {
        ...currentPayload,
        stats: newStats,
      };
      barData.payload = newPayload; // Update stored payload in the map
      barData.bar.increment(increment, newPayload); // Access bar instance via barData.bar and pass the full updated payload
    }
  }

  stopMultiBar(): void {
    this.multibar?.stop();
    this.multibar = null;
    this.bars.clear();
  }

  // --- Logging Methods ---

  logInfo(message: string): void {
    this.clearLine(); // Clear spinner/progress bar line before logging
    console.log(chalk.blue(message));
    this.redraw(); // Redraw spinner/progress bar if active
  }

  logSuccess(message: string): void {
    this.clearLine();
    console.log(chalk.green(message));
    this.redraw();
  }

  logWarning(message: string): void {
    this.clearLine();
    console.warn(chalk.yellow(message)); // Use console.warn
    this.redraw();
  }

  logError(message: string, error?: Error): void {
    this.clearLine();
    console.error(chalk.red(message)); // Use console.error
    if (error && this.verbose) {
      console.error(chalk.red(error.stack || error.toString()));
    }
    this.redraw();
  }

  // --- Private Helpers ---

  private formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  private getBrailleProgressChar(progress: number): string {
    // Braille characters for smoother progress bar
    if (progress >= 0.875) return "⣿";
    if (progress >= 0.75) return "⣷";
    if (progress >= 0.625) return "⣧";
    if (progress >= 0.5) return "⣇";
    if (progress >= 0.375) return "⡇";
    if (progress >= 0.25) return "⡆";
    if (progress >= 0.125) return "⡄";
    if (progress > 0) return "⡀";
    return " ";
  }

  private formatProgressBar(
    options: cliProgress.Options,
    params: cliProgress.Params,
    payload: ProgressBarPayload
  ): string {
    // Use defined interface
    // Implementation copied and adapted from original gatherer.ts
    const barSize = options.barsize ?? 15; // Use default from multibar setup
    const completeBars = Math.floor(params.progress * barSize);
    const remainderProgress = params.progress * barSize - completeBars;
    const microProgressChar = this.getBrailleProgressChar(remainderProgress); // Use helper method
    const bar =
      "⣿".repeat(completeBars) +
      microProgressChar +
      " ".repeat(Math.max(0, barSize - completeBars - 1)); // Ensure repeat count is non-negative

    const percentage = (params.progress * 100).toFixed(2);
    let timeInfo: string;

    if (params.stopTime == null) {
      // Still running
      if (params.eta != null && params.eta > 0 && Number.isFinite(params.eta)) {
        const eta = this.formatTime(params.eta); // Use helper method
        timeInfo = `ETA: ${chalk.yellow(eta.padStart(9))}`;
      } else {
        timeInfo = "ETA: ---".padStart(14); // Placeholder if ETA is infinite/zero
      }
    } else {
      // Stopped
      const duration = this.formatTime(
        // Use helper method
        (params.stopTime - params.startTime) / 1000
      );
      timeInfo = `Time: ${chalk.yellow(duration.padStart(8))}`;
    }

    // Assuming payload.stats exists and has errorCount
    const stats = (payload.stats as { errorCount: number }) ?? {
      errorCount: 0,
    };

    return (
      // Ensure payload and payload.format exist before accessing padEnd
      `${chalk.white((payload.format ?? "N/A").padEnd(6))} ${bar} ${chalk.green(percentage.padStart(6))}% | ` +
      `${chalk.cyan(params.value.toString().padStart(7))}/${chalk.cyan(params.total.toString().padStart(7))} | ` +
      `${timeInfo} | ` +
      `${chalk.red(stats.errorCount.toString().padStart(5))} errors`
    );
  }

  private clearLine(): void {
    // Logic to clear the current line if a spinner or progress bar is active
    // This prevents logs from messing up the dynamic UI elements.
    // For simplicity, we might just stop/restart them, or use more advanced terminal control.
    // For now, this is a placeholder.
    if (this.spinner || this.multibar) {
      // A simple approach might be to just print a newline, but that pushes the UI down.
      // Proper handling requires cursor manipulation or libraries like 'log-update'.
      // console.log(''); // Simplest, but not ideal
    }
  }

  private redraw(): void {
    // Logic to redraw the spinner or progress bar after logging
    // Placeholder for now.
  }
}
