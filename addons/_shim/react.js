// Add-ons share the app's React (a second copy would break hooks). The build maps `react` to this file.
const R = window.__atlasHost.React
export default R
export const { version, createRef, useDebugValue, Component, PureComponent, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useReducer, useContext, createContext, useSyncExternalStore, useId, useTransition, useDeferredValue, useImperativeHandle, forwardRef, memo, Fragment, createElement, cloneElement, isValidElement, Children, Suspense, lazy, startTransition } = R
