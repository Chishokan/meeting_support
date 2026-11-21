// 英語の単語テストの元データの一覧（学年ごとの冊子）。冊子を足したら、ここにも足す。
import type { Book } from './data/types';
import { CHU1 } from './data/chu1';
import { CHU2 } from './data/chu2';
import { CHU3 } from './data/chu3';

export const BOOKS: Book[] = [CHU1, CHU2, CHU3];
