console.log('Hello from app.js!');

// Example: Change the h1 text on click
document.querySelector('h1').addEventListener('click', () => {
  document.querySelector('h1').textContent = 'Clicked!';
});