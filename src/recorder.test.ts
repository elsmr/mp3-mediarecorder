import { record } from './recorder';

describe('mp3-mediarecorder', () => {
    it('should return true', () => {
        expect(record()).toBe(true);
    });
});
