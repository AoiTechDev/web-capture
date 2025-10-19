export function showAuthNotification() {
  const notification = document.createElement('div')
  notification.className = 'auth-notification'
  
  const content = document.createElement('div')
  content.className = 'auth-notification-content'
  
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '20')
  svg.setAttribute('height', '20')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('fill', 'none')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM9 15V13H11V15H9ZM11 11H9V5H11V11Z')
  path.setAttribute('fill', 'white')
  svg.appendChild(path)
  
  const textContainer = document.createElement('div')
  const title = document.createElement('div')
  title.className = 'auth-notification-title'
  title.textContent = 'Authentication Required'
  const message = document.createElement('div')
  message.className = 'auth-notification-message'
  message.textContent = 'Please sign in to use capture features'
  
  textContainer.appendChild(title)
  textContainer.appendChild(message)
  content.appendChild(svg)
  content.appendChild(textContainer)
  notification.appendChild(content)
  
  document.body.appendChild(notification)
  
  setTimeout(() => {
    notification.classList.add('closing')
    setTimeout(() => {
      notification.remove()
    }, 300)
  }, 4000)
}

