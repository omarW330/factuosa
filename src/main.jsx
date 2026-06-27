import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

if (window.matchMedia && matchMedia('(pointer:coarse)').matches) document.body.classList.add('touch')
createRoot(document.getElementById('root')).render(<App />)
