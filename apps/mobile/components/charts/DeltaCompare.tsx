// specs/components.md — DeltaCompare: `74 → 63` 형식 전후 비교 목록.
import React from 'react';
import { View, ViewStyle } from 'react-native';
import { ScenarioDelta } from '@/src/types';
import { BeforeAfterRow } from '@/components/BeforeAfterRow';

export interface DeltaCompareProps {
  deltas: ScenarioDelta[];
  style?: ViewStyle;
}

export function DeltaCompare({ deltas, style }: DeltaCompareProps) {
  return (
    <View style={style}>
      {deltas.map((d, i) => (
        <BeforeAfterRow key={d.label} delta={d} first={i === 0} />
      ))}
    </View>
  );
}
