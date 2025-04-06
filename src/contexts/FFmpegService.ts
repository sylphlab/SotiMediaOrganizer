// import { injectable } from "inversify"; // REMOVED INVERSIFY
import ffmpeg from 'fluent-ffmpeg';

// @injectable() // REMOVED INVERSIFY
export class FFmpegService {
  constructor() {}

  get ffmpeg() {
    return ffmpeg;
  }

  get ffprobe() {
    return ffmpeg.ffprobe;
  }
}
