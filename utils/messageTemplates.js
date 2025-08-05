function customerTemplate(formData) {
  return `Hi ${formData.name || 'there'}, thank you for contacting us! We have received your submission and will get back to you soon.`;
}

function adminTemplate(formData) {
  return `New contact form submission:\nName: ${formData.name}\nEmail: ${formData.email}\nPhone: ${formData.phone}\nMessage: ${formData.message}`;
}

module.exports = { customerTemplate, adminTemplate };
