import { describe, it, expect, vi } from 'vitest';
import {
  isPictureInPictureSupported,
  isVideoInPip,
  togglePictureInPicture,
  type PipDocument,
  type PipVideoElement,
} from './pip';

describe('pip utilities', () => {
  describe('isPictureInPictureSupported', () => {
    it('retorna true quando pictureInPictureEnabled for true no documento mock', () => {
      const mockDoc: PipDocument = { pictureInPictureEnabled: true };
      expect(isPictureInPictureSupported(mockDoc)).toBe(true);
    });

    it('retorna false quando pictureInPictureEnabled for false', () => {
      const mockDoc: PipDocument = { pictureInPictureEnabled: false };
      expect(isPictureInPictureSupported(mockDoc)).toBe(false);
    });
  });

  describe('isVideoInPip', () => {
    it('retorna true se o vídeo for o pictureInPictureElement atual', () => {
      const video = {} as Element;
      const mockDoc: PipDocument = { pictureInPictureElement: video };
      expect(isVideoInPip(video, mockDoc)).toBe(true);
    });

    it('retorna false se outro elemento ou nenhum estiver em PiP', () => {
      const video = {} as Element;
      const otherVideo = {} as Element;
      const mockDoc: PipDocument = { pictureInPictureElement: otherVideo };
      expect(isVideoInPip(video, mockDoc)).toBe(false);
      expect(isVideoInPip(null, mockDoc)).toBe(false);
    });
  });

  describe('togglePictureInPicture', () => {
    it('sai de PiP se já houver um elemento ativo', async () => {
      const exitFn = vi.fn().mockResolvedValue(undefined);
      const video = {} as Element & PipVideoElement;
      const mockDoc: PipDocument = {
        pictureInPictureElement: video,
        exitPictureInPicture: exitFn,
      };

      const result = await togglePictureInPicture(video, mockDoc);
      expect(exitFn).toHaveBeenCalledTimes(1);
      expect(result).toBe(false);
    });

    it('entra em PiP se não houver elemento ativo', async () => {
      const requestFn = vi.fn().mockResolvedValue({});
      const video = { requestPictureInPicture: requestFn } as unknown as Element & PipVideoElement;
      const mockDoc: PipDocument = {
        pictureInPictureElement: null,
      };

      const result = await togglePictureInPicture(video, mockDoc);
      expect(requestFn).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('retorna false graciosamente se video for nulo', async () => {
      const mockDoc: PipDocument = { pictureInPictureElement: null };
      const result = await togglePictureInPicture(null, mockDoc);
      expect(result).toBe(false);
    });
  });
});
